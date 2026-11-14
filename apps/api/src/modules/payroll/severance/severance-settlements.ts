import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { addDays, daysBetween } from '../../../shared/time/calendar.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import {
  EmployeeNotFound,
  type RateTableNotFound,
  SeveranceInterimDateInvalid,
  SeveranceLaterSettlementCompleted,
  SeveranceNotApplicable,
  SeverancePaymentDateInvalid,
  SeveranceServiceStartChanged,
  SeveranceRetirementMismatch,
  SeveranceSettlementExists,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import {
  type CreateSeveranceSettlement,
  type SeveranceCommand,
  type SeveranceSettlement,
  type SeveranceSettlementCandidate,
  severanceResponse,
  type UpdateSeveranceSettlement,
} from './severance-settlement.ts'
import { kindOf, serviceStartDateOf } from './severance-interim.ts'
import { retirementMismatchOf } from './severance-retirement.ts'
import {
  decideSeveranceCreation,
  decideSeveranceTransition,
  decideSeveranceUpdate,
  type SeveranceDecision,
} from './severance-settlement.aggregate.ts'
import { SeveranceSettlementRepository } from './severance-settlement-repository.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'

/** 퇴직금 정산 유스케이스가 쓰는 저장소와 포트입니다. */
export type SeveranceDeps =
  | SeveranceSettlementRepository
  | PayrollEmployeeDirectory
  | RateTableRepository
  | WithholdingFilingLock
  | PayrollEventPublisher

type Response = typeof SeveranceSettlement.Type
type SeveranceError =
  | AccessDenied
  | VersionMismatch
  | SeveranceSettlementNotFound
  | SeveranceTransitionInvalid
  | SeveranceNotApplicable
  | SeverancePaymentDateInvalid
  | SeveranceRetirementMismatch
  | SeveranceSettlementExists
  | SeveranceInterimDateInvalid
  | SeveranceServiceStartChanged
  | SeveranceLaterSettlementCompleted
  | EmployeeNotFound
  | RateTableNotFound
  | WithholdingFiled
type Run<A, E = SeveranceError> = Effect.Effect<A, E, CurrentActor | SeveranceDeps>

const PLANS = ['PAYROLL'] as const

/**
 * 퇴직금 정산 목록입니다. 마지막 근무일 순입니다.
 *
 * `paymentMonth`(`YYYY-MM`)를 주면 지급일이 그 달인 정산만 줍니다. 원천세 퇴직소득 그 외(A22)는 `status=COMPLETED`와 함께 읽습니다.
 * 지급일이 없는 정산(계산됨에서 아직 정하지 않았거나 지급일이 생기기 전에 완료한 정산)은 어느 달에도 들지 않습니다.
 * 정산마다 HR 퇴직일과 대조한 `retirementMismatch`를 붙입니다(목록 전체를 HR에 한 번 묻습니다).
 */
export const listSettlements = (filter: {
  readonly status?: SeveranceStatus
  readonly paymentMonth?: string
}): Run<{ items: Response[] }, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:read', plans: PLANS, requiresTerms: true })
    const records = (yield* (yield* SeveranceSettlementRepository).list(actor.companyId))
      .filter((record) => filter.status === undefined || record.status === filter.status)
      .filter((record) => filter.paymentMonth === undefined || paymentMonthOf(record) === filter.paymentMonth)
    const leaveDates = yield* currentLeaveDates(
      actor.companyId,
      records.map((record) => record.employeeId),
    )
    return {
      items: records.map((record) => severanceResponse(record, mismatchOf(record, leaveDates.get(record.employeeId)))),
    }
  })

/** 정산의 지급월(`YYYY-MM`)입니다. 지급일이 없으면 `undefined`입니다. */
function paymentMonthOf(record: SeveranceSettlementRecord): string | undefined {
  return record.paymentDate?.slice(0, 7)
}

/** 퇴직금 정산 하나입니다. */
export const getSettlement = (
  id: Id<'severanceSettlement'>,
): Run<Response, AccessDenied | SeveranceSettlementNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:read', plans: PLANS, requiresTerms: true })
    return yield* respond(yield* findOrFail(actor.companyId, id))
  })

/**
 * 정산을 만듭니다. 퇴직 정산은 퇴사한 직원의 HR 퇴직일까지, 중간정산은 재직 중인 직원의 기준일까지의 퇴직금입니다.
 *
 * 퇴직 정산은 퇴직금 제도(`SEVERANCE_PAY`) 직원만 받고, 같은 마지막 근무일로 제외되지 않은 정산이 있으면 409입니다.
 * 마지막 완료 중간정산이 퇴직일과 같거나 늦으면 정산할 기간이 없어 422 `NO_SERVICE_AFTER_INTERIM`입니다.
 * 근속일수는 기산일(마지막 완료 중간정산 다음 날, 없으면 입사일)부터 셉니다. 퇴직소득세는 마지막 근무일 달의 기준표를 씁니다.
 */
export const createSettlement = (payload: typeof CreateSeveranceSettlement.Type): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:create', plans: PLANS, requiresTerms: true })
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const today = companyDate(Date.parse(now))
    const employee = yield* (yield* PayrollEmployeeDirectory).find(actor.companyId, payload.employeeId, today)
    const facts = {
      settlements: yield* (yield* SeveranceSettlementRepository).list(actor.companyId),
      filedPaymentMonths: yield* filedAmong(actor.companyId, [payload.paymentDate]),
      rateTables: yield* rateTables,
      employee: Option.getOrUndefined(employee),
      today,
    }
    const decision = yield* Effect.fromResult(
      decideSeveranceCreation({ ...payload, id: newId('severanceSettlement'), companyId: actor.companyId }, facts, now),
    )
    yield* save(decision)
    // 방금 읽은 HR 퇴직일로 만들었으므로 어긋남이 없습니다.
    return severanceResponse(decision.settlement, null)
  })

/**
 * 퇴직금 정산 후보입니다. 기간 안에 퇴사한 퇴직금 제도 직원 중 그 퇴직의 정산(제외 말고)이 없는 직원이고, 퇴직일 순입니다.
 *
 * 기간은 퇴직일 기준이고 기본값은 3년 전 오늘부터 오늘까지입니다(퇴직금 청구권 소멸시효 3년, 근로자퇴직급여 보장법 제10조).
 * 마지막 완료 중간정산이 퇴직일과 같거나 늦어 정산할 기간이 없는 직원은 빠집니다.
 */
export const listCandidates = (filter: {
  readonly from?: string
  readonly to?: string
}): Run<{ items: Array<typeof SeveranceSettlementCandidate.Type> }, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:read', plans: PLANS, requiresTerms: true })
    const today = companyDate(yield* Clock.currentTimeMillis)
    const to = filter.to ?? today
    const from = filter.from ?? `${String(Number(today.slice(0, 4)) - 3)}${today.slice(4)}`
    if (from > to) return { items: [] }
    const employees = yield* (yield* PayrollEmployeeDirectory).listWageEarners(actor.companyId, {
      start: from,
      end: to,
    })
    const settlements = yield* (yield* SeveranceSettlementRepository).list(actor.companyId)
    const items = employees.flatMap((employee) => {
      const leaveDate = employee.leaveDate
      if (leaveDate === null || leaveDate < from || leaveDate > to) return []
      if (employee.retirementBenefitType !== 'SEVERANCE_PAY') return []
      const settled = settlements.some(
        (record) =>
          record.employeeId === employee.id &&
          kindOf(record) === 'RETIREMENT' &&
          record.lastWorkDate === leaveDate &&
          record.status !== 'EXCLUDED',
      )
      const serviceStartDate = serviceStartDateOf(employee.joinDate, settlements, employee.id, addDays(leaveDate, 1))
      if (settled || serviceStartDate > leaveDate) return []
      return [
        {
          employeeId: employee.id,
          employeeName: employee.name,
          joinDate: employee.joinDate,
          leaveDate,
          serviceStartDate,
          eligible: daysBetween(employee.joinDate, leaveDate) + 1 >= 365,
        },
      ]
    })
    return { items: items.toSorted((a, b) => a.leaveDate.localeCompare(b.leaveDate)) }
  })

/**
 * 계산됨 상태에서 입력·지급일을 고치고 다시 계산합니다. 빠진 필드는 그대로 두고, `paymentDate: null`은 지급일을 지웁니다.
 * 완료한 정산의 지급일을 바꾸려면 먼저 `:reopen`합니다.
 */
export const updateSettlement = (
  id: Id<'severanceSettlement'>,
  patch: typeof UpdateSeveranceSettlement.Type,
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:update', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    const facts = {
      settlements: yield* (yield* SeveranceSettlementRepository).list(actor.companyId),
      filedPaymentMonths: yield* filedAmong(actor.companyId, [record.paymentDate, patch.paymentDate ?? undefined]),
      rateTables: yield* rateTables,
    }
    const decision = yield* Effect.fromResult(decideSeveranceUpdate(record, patch, facts, yield* nowIso))
    yield* save(decision)
    return yield* respond(decision.settlement)
  })

/**
 * 완료·완료 취소·제외·제외 취소 커맨드입니다.
 *
 * `:complete`는 HR 퇴직일을 다시 읽어 정산의 마지막 근무일과 맞지 않으면(직원 삭제, 퇴사 취소, 다른 날로 다시 퇴사)
 * 409 `SEVERANCE_RETIREMENT_MISMATCH`입니다. HR은 계산됨 정산이 있어도 퇴직을 바꿀 수 있어서, 지급 확정 순간에 맞춰 봅니다.
 */
export const transitionSettlement = (
  id: Id<'severanceSettlement'>,
  command: SeveranceCommand,
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({
      permission:
        command === 'COMPLETE' || command === 'REOPEN'
          ? 'severance-settlement:complete'
          : 'severance-settlement:update',
      plans: PLANS,
      requiresTerms: true,
    })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    const employeeNow = yield* currentLeaveDate(record.companyId, record.employeeId)
    const facts = {
      settlements: yield* (yield* SeveranceSettlementRepository).list(record.companyId),
      filedPaymentMonths: yield* filedAmong(record.companyId, [record.paymentDate, record.lastWorkDate]),
      employeeNow,
    }
    const decision = yield* Effect.fromResult(decideSeveranceTransition(record, command, facts, yield* nowIso))
    yield* save(decision)
    return severanceResponse(decision.settlement, mismatchOf(decision.settlement, employeeNow))
  })

/** 정산 응답입니다. HR 퇴직일을 지금 읽어 `retirementMismatch`를 붙입니다. */
function respond(record: SeveranceSettlementRecord): Effect.Effect<Response, never, PayrollEmployeeDirectory> {
  return currentLeaveDate(record.companyId, record.employeeId).pipe(
    Effect.map((employee) => severanceResponse(record, mismatchOf(record, employee))),
  )
}

/** 정산 종류에 맞춰 HR의 지금 퇴직과 대조합니다. */
function mismatchOf(record: SeveranceSettlementRecord, employee: { readonly leaveDate: string | null } | undefined) {
  return retirementMismatchOf(record.lastWorkDate, employee, kindOf(record))
}

/** HR의 지금 퇴직일입니다. HR에 없으면 `undefined`입니다. */
function currentLeaveDate(
  companyId: Id<'company'>,
  employeeId: Id<'employee'>,
): Effect.Effect<{ leaveDate: string | null } | undefined, never, PayrollEmployeeDirectory> {
  return currentLeaveDates(companyId, [employeeId]).pipe(Effect.map((leaveDates) => leaveDates.get(employeeId)))
}

/** 직원별 지금 퇴직일입니다. HR에 한 번만 묻고, HR에 없는 직원은 맵에 없습니다. */
function currentLeaveDates(
  companyId: Id<'company'>,
  employeeIds: ReadonlyArray<Id<'employee'>>,
): Effect.Effect<ReadonlyMap<Id<'employee'>, { leaveDate: string | null }>, never, PayrollEmployeeDirectory> {
  return Effect.gen(function* () {
    if (employeeIds.length === 0) return new Map()
    return yield* (yield* PayrollEmployeeDirectory).leaveDatesOf(companyId, [...new Set(employeeIds)])
  })
}

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

/** 퇴직금 계산에 쓰는 기준표 전체입니다. */
const rateTables = Effect.gen(function* () {
  const records = yield* (yield* RateTableRepository).list()
  return records.map((record) => record.table)
})

/** 날짜들의 지급월 중 원천세가 신고된 달입니다. 날짜가 없으면 건너뜁니다. */
function filedAmong(
  companyId: Id<'company'>,
  dates: ReadonlyArray<string | undefined>,
): Effect.Effect<ReadonlySet<string>, never, WithholdingFilingLock> {
  return Effect.gen(function* () {
    const lock = yield* WithholdingFilingLock
    const filed = new Set<string>()
    const months = new Set(dates.filter((date) => date !== undefined).map((date) => date.slice(0, 7)))
    for (const paymentMonth of months) {
      if (yield* lock.isFiled(companyId, paymentMonth)) filed.add(paymentMonth)
    }
    return filed
  })
}

/** 판정한 정산을 저장하고 퇴직소득 합계가 바뀐 지급월 이벤트를 냅니다. */
function save(
  decision: SeveranceDecision,
): Effect.Effect<void, never, SeveranceSettlementRepository | PayrollEventPublisher> {
  return Effect.gen(function* () {
    yield* (yield* SeveranceSettlementRepository).save(decision.settlement)
    const publisher = yield* PayrollEventPublisher
    for (const event of decision.events) yield* publisher.publish(event)
  })
}

function findOrFail(
  companyId: Id<'company'>,
  id: Id<'severanceSettlement'>,
): Effect.Effect<SeveranceSettlementRecord, SeveranceSettlementNotFound, SeveranceSettlementRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* SeveranceSettlementRepository).find(companyId, id)
    if (Option.isNone(found)) return yield* new SeveranceSettlementNotFound({})
    return found.value
  })
}
