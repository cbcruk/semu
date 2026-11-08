import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { calculateSeverancePay } from '../engine/severance-pay.ts'
import {
  EmployeeNotFound,
  type RateTableNotFound,
  SeveranceNotApplicable,
  SeverancePaymentDateInvalid,
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
  severanceResponse,
  type UpdateSeveranceSettlement,
} from './severance-settlement.ts'
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
      items: records.map((record) =>
        severanceResponse(record, retirementMismatchOf(record.lastWorkDate, leaveDates.get(record.employeeId))),
      ),
    }
  })

/** 정산의 지급월(`YYYY-MM`)입니다. 지급일이 없으면 `undefined`입니다. */
function paymentMonthOf(record: SeveranceSettlementRecord): string | undefined {
  return record.paymentDate?.slice(0, 7)
}

/**
 * 지급일이 마지막 근무일보다 앞서면 422입니다. 퇴직금은 퇴직으로 생기는 지급이라 퇴직 전에 줄 수 없습니다
 * (중간정산은 아직 없음). 마지막 근무일 당일은 받습니다. 현행 `complete`가 지급일이 없으면 이 날로 채웠습니다.
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
 * 퇴사한 직원의 퇴직금을 계산해 정산을 만듭니다. 퇴직금 제도(`SEVERANCE_PAY`) 직원만 받고,
 * 같은 마지막 근무일로 제외되지 않은 정산이 있으면 409입니다. 퇴직소득세는 퇴직월 기준표를 씁니다.
 */
export const createSettlement = (payload: typeof CreateSeveranceSettlement.Type): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:create', plans: PLANS, requiresTerms: true })
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const found = yield* (yield* PayrollEmployeeDirectory).find(
      actor.companyId,
      payload.employeeId,
      companyDate(Date.parse(now)),
    )
    if (Option.isNone(found)) return yield* new EmployeeNotFound({})
    const employee = found.value
    if (employee.leaveDate === null) return yield* new SeveranceNotApplicable({ reason: 'NOT_LEFT' })
    if (employee.retirementBenefitType !== 'SEVERANCE_PAY') {
      return yield* new SeveranceNotApplicable({ reason: 'NOT_SEVERANCE_PAY_PLAN' })
    }
    const repository = yield* SeveranceSettlementRepository
    const existing = (yield* repository.list(actor.companyId)).find(
      (record) =>
        record.employeeId === employee.id && record.lastWorkDate === employee.leaveDate && record.status !== 'EXCLUDED',
    )
    if (existing !== undefined) return yield* new SeveranceSettlementExists({ settlementId: existing.id })
    yield* checkPaymentDate(employee.leaveDate, payload.paymentDate)
    const calculated = yield* calculate(employee.joinDate, employee.leaveDate, payload.input)
    const record: SeveranceSettlementRecord = {
      id: newId('severanceSettlement'),
      companyId: actor.companyId,
      employeeId: employee.id,
      employeeName: employee.name,
      joinDate: employee.joinDate,
      lastWorkDate: employee.leaveDate,
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
    const calculated = yield* calculate(record.joinDate, record.lastWorkDate, input)
    const next: SeveranceSettlementRecord = {
      ...rest,
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
    const mismatch = retirementMismatchOf(record.lastWorkDate, employee)
    if (command === 'COMPLETE' && mismatch !== null) {
      return yield* new SeveranceRetirementMismatch({
        reason: mismatch,
        lastWorkDate: record.lastWorkDate,
        leaveDate: employee?.leaveDate ?? null,
      })
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
    Effect.map((employee) => severanceResponse(record, retirementMismatchOf(record.lastWorkDate, employee))),
  )
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
  lastWorkDate: string,
  input: typeof SeveranceInputSchema.Type,
): Effect.Effect<Pick<SeveranceSettlementRecord, 'result' | 'rateTable'>, RateTableNotFound, RateTableRepository> {
  return Effect.gen(function* () {
    const rates = yield* resolveOrFail(lastWorkDate.slice(0, 7))
    return {
      result: calculateSeverancePay({ joinDate, lastWorkDate, ...input }, rates.table),
      rateTable: rates.table.effectiveFrom,
    }
  })
}
