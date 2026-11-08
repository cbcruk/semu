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
  SeveranceSettlementExists,
  SeveranceSettlementNotFound,
  SeveranceTransitionInvalid,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
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
import { SeveranceSettlementRepository } from './severance-settlement-repository.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'

/** 퇴직금 정산 유스케이스가 쓰는 저장소와 포트입니다. */
export type SeveranceDeps = SeveranceSettlementRepository | PayrollEmployeeDirectory | RateTableRepository

type Response = typeof SeveranceSettlement.Type
type SeveranceError =
  | AccessDenied
  | VersionMismatch
  | SeveranceSettlementNotFound
  | SeveranceTransitionInvalid
  | SeveranceNotApplicable
  | SeverancePaymentDateInvalid
  | SeveranceSettlementExists
  | EmployeeNotFound
  | RateTableNotFound
type Run<A, E = SeveranceError> = Effect.Effect<A, E, CurrentActor | SeveranceDeps>

const PLANS = ['PAYROLL'] as const

/**
 * 퇴직금 정산 목록입니다. 마지막 근무일 순입니다.
 *
 * `paymentMonth`(`YYYY-MM`)를 주면 지급일이 그 달인 정산만 줍니다. 원천세 퇴직소득 그 외(A22)는 `status=COMPLETED`와 함께 읽습니다.
 * 지급일이 없는 정산(계산됨에서 아직 정하지 않았거나 지급일이 생기기 전에 완료한 정산)은 어느 달에도 들지 않습니다.
 */
export const listSettlements = (filter: {
  readonly status?: SeveranceStatus
  readonly paymentMonth?: string
}): Run<{ items: Response[] }, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'severance-settlement:read', plans: PLANS, requiresTerms: true })
    const records = yield* (yield* SeveranceSettlementRepository).list(actor.companyId)
    return {
      items: records
        .filter((record) => filter.status === undefined || record.status === filter.status)
        .filter((record) => filter.paymentMonth === undefined || paymentMonthOf(record) === filter.paymentMonth)
        .map(severanceResponse),
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
    return severanceResponse(yield* findOrFail(actor.companyId, id))
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
    yield* repository.save(record)
    return severanceResponse(record)
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
    yield* (yield* SeveranceSettlementRepository).save(next)
    return severanceResponse(next)
  })

/** 완료·완료 취소·제외·제외 취소 커맨드입니다. */
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
    const next: SeveranceSettlementRecord = {
      ...record,
      // 현행 `complete`처럼 지급일이 없으면 마지막 근무일로 채웁니다. 그래서 완료된 정산은 모두 지급월이 있습니다.
      ...(command === 'COMPLETE' && record.paymentDate === undefined ? { paymentDate: record.lastWorkDate } : {}),
      status: rule.to,
      version: record.version + 1,
      updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    }
    yield* (yield* SeveranceSettlementRepository).save(next)
    return severanceResponse(next)
  })

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
