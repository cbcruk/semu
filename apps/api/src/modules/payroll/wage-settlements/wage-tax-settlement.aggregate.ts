import { Result } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import type { PayrollLedgerRecord } from '../ledgers/payroll-ledger.types.ts'
import {
  EmployeeNotFound,
  RateTableNotFound,
  WageSettlementExists,
  WageSettlementNotApplicable,
  WageSettlementPaymentDateInvalid,
  WageSettlementTransitionInvalid,
  WithholdingFiled,
} from '../payroll-problems.ts'
import type { PayrollEmployee } from '../ports/payroll-employee-directory.ts'
import type { PayrollEvent } from '../ports/payroll-events.types.ts'
import type { CreateWageTaxSettlement, UpdateWageTaxSettlement } from './wage-tax-settlement.ts'
import {
  calculateWageSettlement,
  defaultSettlementPaymentDate,
  earliestSettlementPaymentDate,
  wageSettlementMonthsChanged,
  wageSettlementMonthsTouched,
  wageSettlementRejectionOf,
  wageYearTotalsOf,
} from './wage-tax-settlement-rules.ts'
import type { WageSettlementKind, WageTaxSettlementRecord } from './wage-tax-settlement.types.ts'

/**
 * 근로소득 정산(중도퇴사자 연말정산·연말정산) 애그리거트입니다(docs/design/domain-model.md). 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 시각은 `at`으로, 서비스가 읽어 둔 사실(HR 직원의 지금과 정산 기준일 정보, 같은 회사의 급여대장,
 * 기준표, 원천세가 신고된 지급월)은 인자로 받습니다. 결과는 저장할 정산과 원천세 합계가 바뀐 지급월 이벤트이거나 거부입니다.
 * 이벤트 ID만은 판정 안에서 만듭니다.
 *
 * 정산 대상·지급일·합계·세액 규칙(`wage-tax-settlement-rules.ts`)은 규칙 모듈에 그대로 두고 여기서 부릅니다.
 */

/** 판정 결과입니다. `events`는 `settlement`와 같은 트랜잭션에 냅니다. */
export interface WageSettlementDecision {
  settlement: WageTaxSettlementRecord
  events: PayrollEvent[]
}

/**
 * 정산 판정이 함께 받는 사실입니다.
 *
 * - `employeeNow`: 오늘 기준 HR 직원. 없으면 `undefined`
 * - `employeeAtBasis`: 정산 기준일({@link wageSettlementBasisDate}) 기준 HR 직원. 공제대상가족 수를 여기서 읽고, 없으면 `employeeNow`를 씁니다
 * - `ledgers`: 같은 회사의 급여대장 전체. 그해 귀속의 마감된 대장 행을 모읍니다
 * - `filedPaymentMonths`: 원천세가 신고된 지급월. 서비스는 정산의 지급일 달과 바꿀 지급일의 달만 물어 채웁니다
 */
export interface WageSettlementFacts {
  employeeNow: PayrollEmployee | undefined
  employeeAtBasis: PayrollEmployee | undefined
  ledgers: ReadonlyArray<PayrollLedgerRecord>
  rateTables: ReadonlyArray<PayrollRateTable>
  filedPaymentMonths: ReadonlySet<string>
  today: string
}

/** 정산을 다시 계산할 때 거부하는 이유입니다. */
type RecalculationRejection = EmployeeNotFound | WageSettlementNotApplicable | RateTableNotFound

/**
 * 공제대상가족 수를 읽는 HR 기준일입니다. 중도퇴사는 퇴사일, 연말정산(또는 퇴사하지 않은 직원)은 그해 12월 31일입니다.
 * 서비스는 오늘의 직원을 읽은 뒤 이 날로 한 번 더 읽습니다.
 */
export function wageSettlementBasisDate(kind: WageSettlementKind, year: string, leaveDate: string | null): string {
  return kind === 'MID_YEAR' && leaveDate !== null ? leaveDate : `${year}-12-31`
}

/**
 * 정산 만들기를 판정합니다. 같은 직원·연도·종류의 정산이 있으면 거부합니다. 공제대상가족 수는 정산 기준일의 HR 값이고,
 * 근로소득은 그해 귀속의 마감된 대장 행입니다.
 */
export function decideWageSettlementCreation(
  input: typeof CreateWageTaxSettlement.Type & { id: Id<'wageTaxSettlement'>; companyId: Id<'company'> },
  facts: WageSettlementFacts & { settlements: ReadonlyArray<WageTaxSettlementRecord> },
  at: string,
): Result.Result<
  WageSettlementDecision,
  WageSettlementExists | RecalculationRejection | WageSettlementPaymentDateInvalid | WithholdingFiled
> {
  const existing = facts.settlements.find(
    (record) => record.employeeId === input.employeeId && record.year === input.year && record.kind === input.kind,
  )
  if (existing !== undefined) return Result.fail(new WageSettlementExists({ settlementId: existing.id }))
  const basis = basisOf(input.employeeId, input.kind, input.year, facts)
  if (Result.isFailure(basis)) return Result.fail(basis.failure)
  const paymentDateRejection = paymentDateRejectionOf(input.kind, input.year, input.paymentDate)
  if (paymentDateRejection !== undefined) return Result.fail(paymentDateRejection)
  const settlementInput = { ...input.input }
  const calculated = calculate(input.employeeId, input.kind, input.year, basis.success, settlementInput, facts)
  if (Result.isFailure(calculated)) return Result.fail(calculated.failure)
  return withWithholding(
    undefined,
    {
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      employeeName: basis.success.employeeName,
      kind: input.kind,
      year: input.year,
      joinDate: basis.success.joinDate,
      leaveDate: basis.success.leaveDate,
      dependants: basis.success.dependants,
      input: settlementInput,
      ...calculated.success,
      ...(input.paymentDate === undefined ? {} : { paymentDate: input.paymentDate }),
      status: 'CALCULATED',
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
    facts,
  )
}

/** 계산됨 정산의 입력·지급일 고치기를 판정합니다. 그해 마감된 대장과 HR 공제대상가족 수로 다시 계산합니다. */
export function decideWageSettlementUpdate(
  record: WageTaxSettlementRecord,
  patch: typeof UpdateWageTaxSettlement.Type,
  facts: WageSettlementFacts,
  at: string,
): Result.Result<
  WageSettlementDecision,
  WageSettlementTransitionInvalid | WageSettlementPaymentDateInvalid | RecalculationRejection | WithholdingFiled
> {
  if (record.status !== 'CALCULATED') {
    return Result.fail(new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: 'UPDATE' }))
  }
  const { paymentDate: _previous, ...rest } = record
  const paymentDate = patch.paymentDate === undefined ? record.paymentDate : (patch.paymentDate ?? undefined)
  const paymentDateRejection = paymentDateRejectionOf(record.kind, record.year, paymentDate)
  if (paymentDateRejection !== undefined) return Result.fail(paymentDateRejection)
  const next = recalculated(
    { ...rest, ...(paymentDate === undefined ? {} : { paymentDate }), input: { ...(patch.input ?? record.input) } },
    facts,
    at,
  )
  if (Result.isFailure(next)) return Result.fail(next.failure)
  return withWithholding(record, next.success, facts)
}

/**
 * 확정(`COMPLETE`)과 다시 열기(`REOPEN`)를 판정합니다.
 *
 * 확정은 그해 마감된 대장으로 다시 계산해 그 값을 굳힙니다. 지급일이 없으면 기본값(중도퇴사는 퇴사일, 연말정산은 다음 해 2월
 * 말일)을 채우고, 그 달 원천세에 들어갑니다.
 */
export function decideWageSettlementTransition(
  record: WageTaxSettlementRecord,
  command: 'COMPLETE' | 'REOPEN',
  facts: WageSettlementFacts,
  at: string,
): Result.Result<WageSettlementDecision, WageSettlementTransitionInvalid | RecalculationRejection | WithholdingFiled> {
  const from = command === 'COMPLETE' ? 'CALCULATED' : 'COMPLETED'
  if (record.status !== from) {
    return Result.fail(new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: command }))
  }
  if (command === 'REOPEN') {
    return withWithholding(
      record,
      { ...record, status: 'CALCULATED', version: record.version + 1, updatedAt: at },
      facts,
    )
  }
  const next = recalculated(
    {
      ...record,
      paymentDate: completionPaymentDate(record),
      status: 'COMPLETED',
    },
    facts,
    at,
  )
  if (Result.isFailure(next)) return Result.fail(next.failure)
  return withWithholding(record, next.success, facts)
}

/** 확정할 때의 지급일입니다. 정한 지급일이 없으면 기본값입니다. 서비스는 이 달의 신고 잠금을 함께 묻습니다. */
export function completionPaymentDate(record: WageTaxSettlementRecord): string {
  return record.paymentDate ?? defaultSettlementPaymentDate(record.kind, record.year, record.leaveDate)
}

/** 지우기를 판정합니다. 확정한 정산은 다시 열어야 지울 수 있습니다. 원천세 합계에 들지 않아 신호·잠금이 없습니다. */
export function decideWageSettlementDeletion(
  record: WageTaxSettlementRecord,
): Result.Result<void, WageSettlementTransitionInvalid> {
  return record.status === 'CALCULATED'
    ? Result.void
    : Result.fail(new WageSettlementTransitionInvalid({ settlementStatus: record.status, action: 'DELETE' }))
}

interface EmployeeBasis {
  employeeName: string
  joinDate: string
  leaveDate: string | null
  dependants: number
}

/** 정산 기준일의 HR 직원 정보입니다. 정산할 수 없는 직원·연도면 거부합니다. */
function basisOf(
  employeeId: Id<'employee'>,
  kind: WageSettlementKind,
  year: string,
  facts: WageSettlementFacts,
): Result.Result<EmployeeBasis, EmployeeNotFound | WageSettlementNotApplicable> {
  const current = facts.employeeNow
  if (current === undefined) return Result.fail(new EmployeeNotFound({}))
  const atBasis = facts.employeeAtBasis ?? current
  const rejection = wageSettlementRejectionOf({
    kind,
    year,
    joinDate: current.joinDate,
    leaveDate: current.leaveDate,
    today: facts.today,
    totals: wageYearTotalsOf(facts.ledgers, employeeId, year),
  })
  if (rejection !== null) return Result.fail(new WageSettlementNotApplicable({ reason: rejection }))
  return Result.succeed({
    employeeName: current.name,
    joinDate: current.joinDate,
    leaveDate: current.leaveDate,
    dependants: atBasis.incomeTax.dependants,
  })
}

/** 그해 마감된 대장으로 모으고 계산합니다. 기준표는 그해 마지막 달(중도퇴사는 퇴사월)의 것입니다. */
function calculate(
  employeeId: Id<'employee'>,
  kind: WageSettlementKind,
  year: string,
  basis: EmployeeBasis,
  input: WageTaxSettlementRecord['input'],
  facts: WageSettlementFacts,
): Result.Result<Pick<WageTaxSettlementRecord, 'totals' | 'result' | 'rateTable'>, RateTableNotFound> {
  const totals = wageYearTotalsOf(facts.ledgers, employeeId, year)
  const month = kind === 'MID_YEAR' && basis.leaveDate !== null ? basis.leaveDate.slice(0, 7) : `${year}-12`
  let rates: PayrollRateTable
  try {
    rates = resolveRateTable(facts.rateTables, month as Parameters<typeof resolveRateTable>[1])
  } catch {
    return Result.fail(new RateTableNotFound({ month }))
  }
  return Result.succeed({
    totals,
    result: calculateWageSettlement(totals, basis.dependants, input, rates),
    rateTable: rates.effectiveFrom,
  })
}

/** 레코드를 그해 마감된 대장과 지금 HR 값으로 다시 계산하고 판을 올립니다. */
function recalculated(
  record: WageTaxSettlementRecord,
  facts: WageSettlementFacts,
  at: string,
): Result.Result<WageTaxSettlementRecord, RecalculationRejection> {
  const basis = basisOf(record.employeeId, record.kind, record.year, facts)
  if (Result.isFailure(basis)) return Result.fail(basis.failure)
  const calculated = calculate(record.employeeId, record.kind, record.year, basis.success, record.input, facts)
  if (Result.isFailure(calculated)) return Result.fail(calculated.failure)
  return Result.succeed({
    ...record,
    employeeName: basis.success.employeeName,
    leaveDate: basis.success.leaveDate,
    dependants: basis.success.dependants,
    ...calculated.success,
    version: record.version + 1,
    updatedAt: at,
  })
}

/** 지급일이 그 종류의 가장 이른 날보다 앞서면 거부합니다. */
function paymentDateRejectionOf(
  kind: WageSettlementKind,
  year: string,
  paymentDate: string | undefined,
): WageSettlementPaymentDateInvalid | undefined {
  const earliestDate = earliestSettlementPaymentDate(kind, year)
  return paymentDate !== undefined && paymentDate < earliestDate
    ? new WageSettlementPaymentDateInvalid({ earliestDate })
    : undefined
}

/**
 * 원천세와 맞춥니다. 건드린 지급월 중 신고된 달이 있으면 거부하고, 합계가 바뀐 지급월마다
 * `payroll_pay_month.withholding_changed`를 냅니다. 퇴직금 정산과 같은 규칙입니다.
 */
function withWithholding(
  before: WageTaxSettlementRecord | undefined,
  next: WageTaxSettlementRecord,
  facts: Pick<WageSettlementFacts, 'filedPaymentMonths'>,
): Result.Result<WageSettlementDecision, WithholdingFiled> {
  const filed = wageSettlementMonthsTouched(before, next).find((month) => facts.filedPaymentMonths.has(month))
  if (filed !== undefined) return Result.fail(new WithholdingFiled({ paymentMonth: filed }))
  return Result.succeed({
    settlement: next,
    events: wageSettlementMonthsChanged(before, next).map((paymentMonth) => ({
      type: 'payroll_pay_month.withholding_changed',
      eventId: newId('event'),
      companyId: next.companyId,
      paymentMonth,
      occurredAt: next.updatedAt,
    })),
  })
}
