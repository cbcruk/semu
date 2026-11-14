import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import {
  EmployeeNotFound,
  type RateTableNotFound,
  WageSettlementExists,
  WageSettlementNotApplicable,
  WageSettlementNotFound,
  WageSettlementPaymentDateInvalid,
  WageSettlementTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from '../ports/payroll-events.ts'
import { WithholdingFilingLock } from '../ports/withholding-filing-lock.ts'
import type { RateTableRepository } from '../rate-tables/rate-table-repository.ts'
import { resolveOrFail } from '../rate-tables/rate-tables.ts'
import {
  type CreateWageTaxSettlement,
  type UpdateWageTaxSettlement,
  type WageTaxSettlement,
  wageSettlementResponse,
} from './wage-tax-settlement.ts'
import { WageTaxSettlementRepository } from './wage-tax-settlement-repository.ts'
import {
  calculateWageSettlement,
  defaultSettlementPaymentDate,
  earliestSettlementPaymentDate,
  wageSettlementMonthsChanged,
  wageSettlementMonthsTouched,
  wageSettlementRejectionOf,
  wageYearTotalsOf,
} from './wage-tax-settlement-rules.ts'
import type {
  WageSettlementInput,
  WageSettlementKind,
  WageSettlementStatus,
  WageTaxSettlementRecord,
} from './wage-tax-settlement.types.ts'

/** 근로소득 정산 유스케이스가 쓰는 저장소와 포트입니다. */
export type WageSettlementDeps =
  | WageTaxSettlementRepository
  | PayrollLedgerRepository
  | PayrollEmployeeDirectory
  | RateTableRepository
  | WithholdingFilingLock
  | PayrollEventPublisher

type Response = typeof WageTaxSettlement.Type
type WageSettlementError =
  | AccessDenied
  | VersionMismatch
  | WageSettlementNotFound
  | WageSettlementNotApplicable
  | WageSettlementExists
  | WageSettlementTransitionInvalid
  | WageSettlementPaymentDateInvalid
  | EmployeeNotFound
  | RateTableNotFound
  | WithholdingFiled
type Run<A, E = WageSettlementError> = Effect.Effect<A, E, CurrentActor | WageSettlementDeps>

const PLANS = ['PAYROLL'] as const

/** 근로소득 정산 목록입니다. 과세연도·상태·지급월(확정한 정산이 원천세에 들어가는 달)로 거릅니다. */
export const listWageSettlements = (filter: {
  readonly year?: string
  readonly status?: WageSettlementStatus
  readonly paymentMonth?: string
}): Run<{ items: Response[] }, AccessDenied> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:read', plans: PLANS, requiresTerms: true })
    const records = (yield* (yield* WageTaxSettlementRepository).list(actor.companyId))
      .filter((record) => filter.year === undefined || record.year === filter.year)
      .filter((record) => filter.status === undefined || record.status === filter.status)
      .filter((record) => filter.paymentMonth === undefined || record.paymentDate?.slice(0, 7) === filter.paymentMonth)
    return { items: records.map(wageSettlementResponse) }
  })

/** 근로소득 정산 하나입니다. */
export const getWageSettlement = (id: Id<'wageTaxSettlement'>): Run<Response, AccessDenied | WageSettlementNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:read', plans: PLANS, requiresTerms: true })
    return wageSettlementResponse(yield* findOrFail(actor.companyId, id))
  })

/**
 * 중도퇴사자 연말정산(`MID_YEAR`)이나 연말정산(`ANNUAL`)을 계산해 만듭니다. 같은 직원·연도·종류의 정산이 있으면 409입니다.
 * 공제대상가족 수는 퇴사일(연말정산은 12월 31일)의 HR 값이고, 근로소득은 그해 귀속의 마감된 대장 행입니다.
 */
export const createWageSettlement = (payload: typeof CreateWageTaxSettlement.Type): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:create', plans: PLANS, requiresTerms: true })
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const repository = yield* WageTaxSettlementRepository
    const existing = (yield* repository.list(actor.companyId)).find(
      (record) =>
        record.employeeId === payload.employeeId && record.year === payload.year && record.kind === payload.kind,
    )
    if (existing !== undefined) return yield* new WageSettlementExists({ settlementId: existing.id })
    const today = companyDate(Date.parse(now))
    const basis = yield* employeeBasis(actor.companyId, payload.employeeId, payload.kind, payload.year, today)
    yield* checkPaymentDate(payload.kind, payload.year, payload.paymentDate)
    const input = { ...payload.input }
    const record: WageTaxSettlementRecord = {
      id: newId('wageTaxSettlement'),
      companyId: actor.companyId,
      employeeId: payload.employeeId,
      employeeName: basis.employeeName,
      kind: payload.kind,
      year: payload.year,
      joinDate: basis.joinDate,
      leaveDate: basis.leaveDate,
      dependants: basis.dependants,
      input,
      ...(yield* calculate(actor.companyId, payload.employeeId, payload.kind, payload.year, basis, input)),
      ...(payload.paymentDate === undefined ? {} : { paymentDate: payload.paymentDate }),
      status: 'CALCULATED',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    yield* saveWithWithholding(undefined, record)
    return wageSettlementResponse(record)
  })

/** 계산됨 정산의 입력·지급일을 고치고, 그해 마감된 대장과 HR 공제대상가족 수로 다시 계산합니다. */
export const updateWageSettlement = (
  id: Id<'wageTaxSettlement'>,
  patch: typeof UpdateWageTaxSettlement.Type,
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:update', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    if (record.status !== 'CALCULATED') {
      return yield* new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: 'UPDATE' })
    }
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const { paymentDate: _previous, ...rest } = record
    const paymentDate = patch.paymentDate === undefined ? record.paymentDate : (patch.paymentDate ?? undefined)
    yield* checkPaymentDate(record.kind, record.year, paymentDate)
    const next = yield* recalculated(
      { ...rest, ...(paymentDate === undefined ? {} : { paymentDate }), input: { ...(patch.input ?? record.input) } },
      now,
    )
    yield* saveWithWithholding(record, next)
    return wageSettlementResponse(next)
  })

/**
 * 확정(`:complete`)과 다시 열기(`:reopen`)입니다.
 *
 * 확정은 그해 마감된 대장으로 다시 계산해 그 값을 굳힙니다. 계산한 뒤 대장이 다시 열리거나 마감돼도 확정한 금액이 그때의 대장과
 * 맞게 하려는 것입니다. 지급일이 없으면 기본값(중도퇴사는 퇴사일, 연말정산은 다음 해 2월 말일)을 채우고, 그 달 원천세에 들어갑니다.
 */
export const transitionWageSettlement = (
  id: Id<'wageTaxSettlement'>,
  command: 'COMPLETE' | 'REOPEN',
  expected: number | undefined,
): Run<Response> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:complete', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    const from: WageSettlementStatus = command === 'COMPLETE' ? 'CALCULATED' : 'COMPLETED'
    if (record.status !== from) {
      return yield* new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: command })
    }
    const now = new Date(yield* Clock.currentTimeMillis).toISOString()
    const next =
      command === 'COMPLETE'
        ? yield* recalculated(
            {
              ...record,
              paymentDate:
                record.paymentDate ?? defaultSettlementPaymentDate(record.kind, record.year, record.leaveDate),
              status: 'COMPLETED',
            },
            now,
          )
        : { ...record, status: 'CALCULATED' as const, version: record.version + 1, updatedAt: now }
    yield* saveWithWithholding(record, next)
    return wageSettlementResponse(next)
  })

/** 계산됨 정산을 지웁니다. 확정한 정산은 다시 열어야 지울 수 있습니다. 원천세 합계에 들지 않아 신호·잠금이 없습니다. */
export const deleteWageSettlement = (
  id: Id<'wageTaxSettlement'>,
): Run<void, AccessDenied | WageSettlementNotFound | WageSettlementTransitionInvalid> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'wage-tax-settlement:delete', plans: PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor.companyId, id)
    if (record.status !== 'CALCULATED') {
      return yield* new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: 'DELETE' })
    }
    yield* (yield* WageTaxSettlementRepository).remove(actor.companyId, id)
  })

interface EmployeeBasis {
  employeeName: string
  joinDate: string
  leaveDate: string | null
  dependants: number
}

/** 정산 기준일(퇴사일, 연말정산은 12월 31일)의 HR 직원 정보입니다. 정산할 수 없는 직원·연도면 422입니다. */
function employeeBasis(
  companyId: Id<'company'>,
  employeeId: Id<'employee'>,
  kind: WageSettlementKind,
  year: string,
  today: string,
): Effect.Effect<
  EmployeeBasis,
  EmployeeNotFound | WageSettlementNotApplicable,
  PayrollEmployeeDirectory | PayrollLedgerRepository
> {
  return Effect.gen(function* () {
    const directory = yield* PayrollEmployeeDirectory
    const current = yield* directory.find(companyId, employeeId, today)
    if (Option.isNone(current)) return yield* new EmployeeNotFound({})
    const leaveDate = current.value.leaveDate
    const asOf = kind === 'MID_YEAR' && leaveDate !== null ? leaveDate : `${year}-12-31`
    const atBasis = Option.getOrElse(yield* directory.find(companyId, employeeId, asOf), () => current.value)
    const totals = wageYearTotalsOf(yield* (yield* PayrollLedgerRepository).list(companyId), employeeId, year)
    const rejection = wageSettlementRejectionOf({
      kind,
      year,
      joinDate: current.value.joinDate,
      leaveDate,
      today,
      totals,
    })
    if (rejection !== null) return yield* new WageSettlementNotApplicable({ reason: rejection })
    return {
      employeeName: current.value.name,
      joinDate: current.value.joinDate,
      leaveDate,
      dependants: atBasis.incomeTax.dependants,
    }
  })
}

/** 그해 마감된 대장으로 모으고 계산합니다. 기준표는 그해 마지막 달(중도퇴사는 퇴사월)의 것입니다. */
function calculate(
  companyId: Id<'company'>,
  employeeId: Id<'employee'>,
  kind: WageSettlementKind,
  year: string,
  basis: EmployeeBasis,
  input: WageSettlementInput,
): Effect.Effect<
  Pick<WageTaxSettlementRecord, 'totals' | 'result' | 'rateTable'>,
  RateTableNotFound,
  PayrollLedgerRepository | RateTableRepository
> {
  return Effect.gen(function* () {
    const totals = wageYearTotalsOf(yield* (yield* PayrollLedgerRepository).list(companyId), employeeId, year)
    const month = kind === 'MID_YEAR' && basis.leaveDate !== null ? basis.leaveDate.slice(0, 7) : `${year}-12`
    const rates = yield* resolveOrFail(month)
    return {
      totals,
      result: calculateWageSettlement(totals, basis.dependants, input, rates.table),
      rateTable: rates.table.effectiveFrom,
    }
  })
}

/** 레코드를 그해 마감된 대장과 지금 HR 값으로 다시 계산하고 판을 올립니다. */
function recalculated(
  record: WageTaxSettlementRecord,
  now: string,
): Effect.Effect<
  WageTaxSettlementRecord,
  RateTableNotFound | EmployeeNotFound | WageSettlementNotApplicable,
  PayrollLedgerRepository | RateTableRepository | PayrollEmployeeDirectory
> {
  return Effect.gen(function* () {
    const basis = yield* employeeBasis(
      record.companyId,
      record.employeeId,
      record.kind,
      record.year,
      companyDate(Date.parse(now)),
    )
    const calculated = yield* calculate(
      record.companyId,
      record.employeeId,
      record.kind,
      record.year,
      basis,
      record.input,
    )
    return {
      ...record,
      employeeName: basis.employeeName,
      leaveDate: basis.leaveDate,
      dependants: basis.dependants,
      ...calculated,
      version: record.version + 1,
      updatedAt: now,
    }
  })
}

/** 지급일이 그 종류의 가장 이른 날보다 앞서면 422입니다. */
function checkPaymentDate(
  kind: WageSettlementKind,
  year: string,
  paymentDate: string | undefined,
): Effect.Effect<void, WageSettlementPaymentDateInvalid> {
  const earliestDate = earliestSettlementPaymentDate(kind, year)
  return paymentDate !== undefined && paymentDate < earliestDate
    ? Effect.fail(new WageSettlementPaymentDateInvalid({ earliestDate }))
    : Effect.void
}

/**
 * 정산을 저장하고 원천세와 맞춥니다. 건드린 지급월 중 신고된 달이 있으면 409 `WITHHOLDING_FILED`이고, 합계가 바뀐 지급월마다
 * `payroll_pay_month.withholding_changed`를 냅니다. 퇴직금 정산과 같은 규칙입니다.
 */
function saveWithWithholding(
  before: WageTaxSettlementRecord | undefined,
  next: WageTaxSettlementRecord,
): Effect.Effect<void, WithholdingFiled, WageTaxSettlementRepository | WithholdingFilingLock | PayrollEventPublisher> {
  return Effect.gen(function* () {
    const lock = yield* WithholdingFilingLock
    for (const paymentMonth of wageSettlementMonthsTouched(before, next)) {
      if (yield* lock.isFiled(next.companyId, paymentMonth)) return yield* new WithholdingFiled({ paymentMonth })
    }
    yield* (yield* WageTaxSettlementRepository).save(next)
    const publisher = yield* PayrollEventPublisher
    for (const paymentMonth of wageSettlementMonthsChanged(before, next)) {
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
  id: Id<'wageTaxSettlement'>,
): Effect.Effect<WageTaxSettlementRecord, WageSettlementNotFound, WageTaxSettlementRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* WageTaxSettlementRepository).find(companyId, id)
    if (Option.isNone(found)) return yield* new WageSettlementNotFound({})
    return found.value
  })
}
