import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { addDays, daysBetween } from '../../../shared/time/calendar.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { calculateSeverancePay } from '../engine/severance-pay.ts'
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
import type { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import { resolveOrFail } from '../rate-tables/rate-tables.ts'
import {
  type CreateSeveranceSettlement,
  SEVERANCE_TRANSITIONS,
  type SeveranceCommand,
  type SeveranceInputSchema,
  type SeveranceSettlement,
  type SeveranceSettlementCandidate,
  severanceResponse,
  type UpdateSeveranceSettlement,
} from './severance-settlement.ts'
import {
  interimDateRange,
  interimRejectionOf,
  kindOf,
  lastCompletedInterimBefore,
  laterCompletedSettlementOf,
  serviceStartDateOf,
} from './severance-interim.ts'
import { retirementMismatchOf } from './severance-retirement.ts'
import { SeveranceSettlementRepository } from './severance-settlement-repository.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'
import { severanceMonthsTouched, severanceWithholdingMonthsChanged } from './severance-withholding.ts'

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

/**
 * 지급일이 마지막 근무일(중간정산은 기준일)보다 앞서면 422입니다. 퇴직금은 퇴직·중간정산으로 생기는 지급이라 그 전에 줄 수 없습니다.
 * 당일은 받습니다. 현행 `complete`가 지급일이 없으면 이 날로 채웠습니다.
 */
function checkPaymentDate(
  lastWorkDate: string,
  paymentDate: string | undefined,
): Effect.Effect<void, SeverancePaymentDateInvalid> {
  return paymentDate !== undefined && paymentDate < lastWorkDate
    ? Effect.fail(new SeverancePaymentDateInvalid({ lastWorkDate }))
    : Effect.void
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
    const found = yield* (yield* PayrollEmployeeDirectory).find(actor.companyId, payload.employeeId, today)
    if (Option.isNone(found)) return yield* new EmployeeNotFound({})
    const employee = found.value
    const repository = yield* SeveranceSettlementRepository
    const settlements = (yield* repository.list(actor.companyId)).filter((record) => record.employeeId === employee.id)
    let lastWorkDate: string
    let interim: Pick<SeveranceSettlementRecord, 'kind' | 'interimReason'>
    if (payload.kind === 'INTERIM') {
      const rejection = interimRejectionOf({
        retirementBenefitType: employee.retirementBenefitType,
        leaveDate: employee.leaveDate,
        joinDate: employee.joinDate,
        settlementDate: payload.settlementDate,
        reason: payload.interimReason,
        settlements,
        employeeId: employee.id,
      })
      const range = interimDateRange(employee.joinDate, settlements, employee.id, today)
      if (payload.settlementDate < range.earliestDate || payload.settlementDate > range.latestDate) {
        return yield* new SeveranceInterimDateInvalid(range)
      }
      if (rejection !== null) return yield* new SeveranceNotApplicable({ reason: rejection })
      // 아직 완료하지 않은 정산이 있으면 그것부터 끝냅니다. 기준일이 엇갈린 계산됨 정산이 둘이면 기산일이 서로를 따라 바뀝니다.
      const open = settlements.find(
        (record) =>
          record.status !== 'EXCLUDED' &&
          (record.status === 'CALCULATED' || record.lastWorkDate === payload.settlementDate),
      )
      if (open !== undefined) return yield* new SeveranceSettlementExists({ settlementId: open.id })
      lastWorkDate = payload.settlementDate
      interim = { kind: 'INTERIM', interimReason: payload.interimReason }
    } else {
      if (employee.leaveDate === null) return yield* new SeveranceNotApplicable({ reason: 'NOT_LEFT' })
      if (employee.retirementBenefitType !== 'SEVERANCE_PAY') {
        return yield* new SeveranceNotApplicable({ reason: 'NOT_SEVERANCE_PAY_PLAN' })
      }
      const leaveDate = employee.leaveDate
      const existing = settlements.find(
        (record) =>
          kindOf(record) === 'RETIREMENT' && record.lastWorkDate === leaveDate && record.status !== 'EXCLUDED',
      )
      if (existing !== undefined) return yield* new SeveranceSettlementExists({ settlementId: existing.id })
      if (lastCompletedInterimBefore(settlements, employee.id, addDays(leaveDate, 1)) !== undefined) {
        if (serviceStartDateOf(employee.joinDate, settlements, employee.id, addDays(leaveDate, 1)) > leaveDate) {
          return yield* new SeveranceNotApplicable({ reason: 'NO_SERVICE_AFTER_INTERIM' })
        }
      }
      lastWorkDate = leaveDate
      interim = {}
    }
    yield* checkPaymentDate(lastWorkDate, payload.paymentDate)
    const serviceStartDate = serviceStartDateOf(employee.joinDate, settlements, employee.id, lastWorkDate)
    const calculated = yield* calculate(employee.joinDate, serviceStartDate, lastWorkDate, payload.input)
    const record: SeveranceSettlementRecord = {
      id: newId('severanceSettlement'),
      companyId: actor.companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      kind: interim.kind ?? 'RETIREMENT',
      ...(interim.interimReason === undefined ? {} : { interimReason: interim.interimReason }),
      joinDate: employee.joinDate,
      serviceStartDate,
      lastWorkDate,
      ...(payload.paymentDate === undefined ? {} : { paymentDate: payload.paymentDate }),
      status: 'CALCULATED',
      input: { ...payload.input },
      ...calculated,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    yield* saveWithWithholding(undefined, record)
    // 방금 읽은 HR 퇴직일로 만들었으므로 어긋남이 없습니다.
    return severanceResponse(record, null)
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
    if (record.status !== 'CALCULATED') {
      return yield* new SeveranceTransitionInvalid({ settlementStatus: record.status, action: 'UPDATE' })
    }
    const input = patch.input ?? record.input
    const { paymentDate: _previous, ...rest } = record
    const paymentDate = patch.paymentDate === undefined ? record.paymentDate : (patch.paymentDate ?? undefined)
    yield* checkPaymentDate(record.lastWorkDate, paymentDate)
    // 다시 계산할 때 기산일도 지금의 완료 중간정산으로 다시 정합니다. `SEVERANCE_SERVICE_START_CHANGED`를 푸는 길입니다.
    const settlements = yield* (yield* SeveranceSettlementRepository).list(actor.companyId)
    const serviceStartDate = serviceStartDateOf(record.joinDate, settlements, record.employeeId, record.lastWorkDate)
    const calculated = yield* calculate(record.joinDate, serviceStartDate, record.lastWorkDate, input)
    const next: SeveranceSettlementRecord = {
      ...rest,
      serviceStartDate,
      ...(paymentDate === undefined ? {} : { paymentDate }),
      input: { ...input },
      ...calculated,
      version: record.version + 1,
      updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    }
    yield* saveWithWithholding(record, next)
    return yield* respond(next)
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
    const rule = SEVERANCE_TRANSITIONS[command]
    if (record.status !== rule.from) {
      return yield* new SeveranceTransitionInvalid({ settlementStatus: record.status, action: command })
    }
    const employee = yield* currentLeaveDate(record.companyId, record.employeeId)
    const mismatch = mismatchOf(record, employee)
    if (command === 'COMPLETE' && mismatch !== null) {
      return yield* new SeveranceRetirementMismatch({
        reason: mismatch,
        lastWorkDate: record.lastWorkDate,
        leaveDate: employee?.leaveDate ?? null,
      })
    }
    if (command === 'COMPLETE' || command === 'REOPEN') {
      const settlements = yield* (yield* SeveranceSettlementRepository).list(record.companyId)
      if (command === 'COMPLETE') {
        const serviceStartDate = serviceStartDateOf(
          record.joinDate,
          settlements,
          record.employeeId,
          record.lastWorkDate,
        )
        if (serviceStartDate !== (record.serviceStartDate ?? record.joinDate)) {
          return yield* new SeveranceServiceStartChanged({ serviceStartDate })
        }
      }
      // 중간정산을 완료하거나 다시 열면 그 뒤 정산의 기산일이 바뀝니다. 늦은 정산이 이미 완료됐으면 막습니다.
      const later = kindOf(record) === 'INTERIM' ? laterCompletedSettlementOf(settlements, record) : undefined
      if (later !== undefined) return yield* new SeveranceLaterSettlementCompleted({ settlementId: later.id })
    }
    const next: SeveranceSettlementRecord = {
      ...record,
      // 현행 `complete`처럼 지급일이 없으면 마지막 근무일로 채웁니다. 그래서 완료된 정산은 모두 지급월이 있습니다.
      ...(command === 'COMPLETE' && record.paymentDate === undefined ? { paymentDate: record.lastWorkDate } : {}),
      status: rule.to,
      version: record.version + 1,
      updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    }
    yield* saveWithWithholding(record, next)
    return severanceResponse(next, mismatch)
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

/**
 * 정산을 저장하고 원천세와 맞춥니다([payroll.md 퇴직금 정산](../../../../../../docs/design/payroll.md#퇴직금-정산)).
 *
 * 건드린 지급월(`severanceMonthsTouched`) 중 원천세가 신고된 달이 있으면 저장하지 않고 409 `WITHHOLDING_FILED`입니다.
 * 급여대장과 같은 잠금입니다. 저장한 뒤 퇴직소득 합계가 바뀐 지급월마다 `payroll_pay_month.withholding_changed`를 냅니다.
 */
function saveWithWithholding(
  before: SeveranceSettlementRecord | undefined,
  next: SeveranceSettlementRecord,
): Effect.Effect<
  void,
  WithholdingFiled,
  SeveranceSettlementRepository | WithholdingFilingLock | PayrollEventPublisher
> {
  return Effect.gen(function* () {
    const lock = yield* WithholdingFilingLock
    for (const paymentMonth of severanceMonthsTouched(before, next)) {
      if (yield* lock.isFiled(next.companyId, paymentMonth)) return yield* new WithholdingFiled({ paymentMonth })
    }
    yield* (yield* SeveranceSettlementRepository).save(next)
    const publisher = yield* PayrollEventPublisher
    for (const paymentMonth of severanceWithholdingMonthsChanged(before, next)) {
      yield* publisher.publish({
        type: 'payroll_pay_month.withholding_changed',
        eventId: newId('event'),
        companyId: next.companyId,
        paymentMonth,
        occurredAt: next.updatedAt,
      })
    }
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

function calculate(
  joinDate: string,
  serviceStartDate: string,
  lastWorkDate: string,
  input: typeof SeveranceInputSchema.Type,
): Effect.Effect<Pick<SeveranceSettlementRecord, 'result' | 'rateTable'>, RateTableNotFound, RateTableRepository> {
  return Effect.gen(function* () {
    const rates = yield* resolveOrFail(lastWorkDate.slice(0, 7))
    return {
      result: calculateSeverancePay({ joinDate, serviceStartDate, lastWorkDate, ...input }, rates.table),
      rateTable: rates.table.effectiveFrom,
    }
  })
}
