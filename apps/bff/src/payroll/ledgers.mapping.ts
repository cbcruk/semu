import { LegacyError, legacyErrors } from '../legacy-error.ts'
import type {
  PayrollIncomeType,
  PayrollLedger,
  PayrollLedgerStatus,
  PayrollRow,
  PayrollRowInput,
} from '../upstream.types.ts'

/**
 * 현행 급여카드(급여 관리) ↔ 새 급여대장 번역입니다.
 *
 * 현행 카드 응답은 카드 머리와 행 집계(소득 구분별 인원·합계)를 함께 주므로, 대장 하나를 옮길 때 그 행도 같이 읽어야 합니다.
 */

/** 현행 카드 상태(`card_status`)입니다. 새 상태 넷을 현행 상태로 옮깁니다. */
export type LegacyCardStatus = 'inputting' | 'calculated' | 'approval_requested' | 'approved'

/** 현행 `card-status`의 세 단계입니다. */
export type LegacyStatus = 'input_available' | 'calculating' | 'done'

/** 현행 소득 구분(경로·`income_type`)입니다. 근로는 하나로 묶고 기타소득은 `other-labor`입니다. */
export type LegacySegment = 'wage-salary' | 'daily' | 'business' | 'other-labor'

/** 현행 응답의 소득 구분별 키입니다. */
type LegacyKey = 'wage_salary' | 'daily' | 'business' | 'other_labor'

const CARD_STATUS: Record<PayrollLedgerStatus, LegacyCardStatus> = {
  DRAFT: 'inputting',
  SUBMITTED: 'calculated',
  PENDING_APPROVAL: 'approval_requested',
  // 현행 `payslips_sent`·`exported`는 새 API에서 상태가 아니라 마감 뒤 기록입니다.
  CLOSED: 'approved',
}

const BPO_SEGMENT: Record<PayrollIncomeType, string> = {
  WAGE_MONTHLY: 'wage-monthly',
  WAGE_DAILY: 'wage-daily',
  WAGE_HOURLY: 'wage-hourly',
  DAILY: 'daily',
  BUSINESS: 'business',
  OTHER: 'other',
}

const LEGACY_SEGMENT: Record<PayrollIncomeType, LegacySegment> = {
  WAGE_MONTHLY: 'wage-salary',
  WAGE_DAILY: 'wage-salary',
  WAGE_HOURLY: 'wage-salary',
  DAILY: 'daily',
  BUSINESS: 'business',
  OTHER: 'other-labor',
}

const LEGACY_KEY: Record<LegacySegment, LegacyKey> = {
  'wage-salary': 'wage_salary',
  daily: 'daily',
  business: 'business',
  'other-labor': 'other_labor',
}

/** 새 상태 → 현행 `card_status`입니다. */
export function legacyCardStatus(status: PayrollLedgerStatus): LegacyCardStatus {
  return CARD_STATUS[status]
}

/** 새 상태 → 현행 세 단계(입력가능·계산중·완료)입니다. */
export function legacyStatus(status: PayrollLedgerStatus): LegacyStatus {
  if (status === 'DRAFT') return 'input_available'
  return status === 'CLOSED' ? 'done' : 'calculating'
}

/** 소득 구분 → 현행 소득 구분입니다. */
export function legacySegment(incomeType: PayrollIncomeType): LegacySegment {
  return LEGACY_SEGMENT[incomeType]
}

/**
 * 현행 `income_type` 쿼리를 읽습니다. 현행처럼 `wage-salary`와 `wage_salary`를 모두 받고, 비었으면 거르지 않습니다.
 *
 * @throws {LegacyError} 모르는 값이면 현행처럼 404 "Income type not found."
 */
export function parseLegacySegment(value: string | null): LegacySegment | undefined {
  if (value === null || value === '') return undefined
  const normalized = value.replace('_', '-')
  if (normalized in LEGACY_KEY) return normalized as LegacySegment
  throw legacyErrors.notFound('Income type')
}

/** 현행 카드 머리입니다. 현행 `legacySummary`와 같은 키입니다. */
export function toLegacySummary(
  ledger: PayrollLedger,
  rows: readonly PayrollRow[],
  parentCardId: string | null,
): Record<string, unknown> {
  const headcountByType: Record<string, number> = {
    'wage-monthly': 0,
    'wage-daily': 0,
    'wage-hourly': 0,
    daily: 0,
    business: 0,
    other: 0,
  }
  const totalByType: Record<string, { gross_pay: number; net_pay: number }> = {}
  const headcount: Record<LegacyKey, number> = { wage_salary: 0, daily: 0, business: 0, other_labor: 0 }
  const netPayByType: Record<LegacyKey, number> = { wage_salary: 0, daily: 0, business: 0, other_labor: 0 }
  let grossTotal = 0
  let netTotal = 0
  let uncalculated = 0
  for (const row of rows) {
    const segment = BPO_SEGMENT[row.incomeType]
    const key = LEGACY_KEY[legacySegment(row.incomeType)]
    const grossPay = row.result?.grossPay ?? 0
    const netPay = row.result?.netPay ?? 0
    headcountByType[segment] = (headcountByType[segment] ?? 0) + 1
    const total = (totalByType[segment] ??= { gross_pay: 0, net_pay: 0 })
    total.gross_pay += grossPay
    total.net_pay += netPay
    headcount[key] += 1
    netPayByType[key] += netPay
    grossTotal += grossPay
    netTotal += netPay
    if (row.result === null) uncalculated += 1
  }
  const status = legacyStatus(ledger.status)
  return {
    id: ledger.id,
    generation: 'legacy',
    kind: ledger.kind === 'REGULAR' ? 'default' : 'addition',
    parent_card_id: parentCardId,
    title: ledger.title,
    name: ledger.title,
    attribution_month: ledger.attributionMonth,
    attr_date: ledger.attributionMonth,
    payment_date: ledger.paymentDate,
    period_start: ledger.wagePeriod.start,
    period_end: ledger.wagePeriod.end,
    status,
    legacy_status: status,
    card_status: legacyCardStatus(ledger.status),
    step: ledger.step,
    step_count: 3,
    version: ledger.version,
    // 새 대장은 승인 요청 시각·명세서 발송·데스크 내보내기를 대장에 두지 않습니다.
    approval_requested_at: null,
    approved_at: ledger.closedAt,
    rejected_at: ledger.rejection?.rejectedAt ?? null,
    payslips_sent_at: null,
    exported_at: null,
    export_type: null,
    headcount_by_type: headcountByType,
    total_by_type: totalByType,
    headcount,
    net_pay_total_by_type: netPayByType,
    gross_total: grossTotal,
    net_total: netTotal,
    uncalculated_count: uncalculated,
    withholding_filed: ledger.withholdingFiled,
    created_at: ledger.createdAt,
    updated_at: ledger.updatedAt,
  }
}

/** 분 → 시간입니다. 현행 근무 시트는 시간 단위였습니다. */
function hours(minutes: number | undefined): number {
  return (minutes ?? 0) / 60
}

function items(lines: PayrollRowInput['paymentItems']): Array<{ item_id: string; amount: number }> {
  return (lines ?? []).map((line) => ({ item_id: line.code, amount: line.amount }))
}

function amountsByCode(lines: PayrollRowInput['paymentItems']): Record<string, number> {
  return Object.fromEntries((lines ?? []).map((line) => [line.code, line.amount]))
}

function insuranceNotice(notice: PayrollRowInput['insuranceNotice']): Record<string, number> {
  const legacy: Record<string, number> = {}
  if (notice?.nationalPension !== undefined) legacy['national_pension'] = notice.nationalPension
  if (notice?.healthInsurance !== undefined) legacy['health_insurance'] = notice.healthInsurance
  if (notice?.longTermCare !== undefined) legacy['long_term_care'] = notice.longTermCare
  if (notice?.employmentInsurance !== undefined) legacy['employment_insurance'] = notice.employmentInsurance
  return legacy
}

function taxDeductionMode(input: PayrollRowInput): 'before_tax' | 'after_tax' {
  return input.taxDeductionMode === 'AFTER_TAX' ? 'after_tax' : 'before_tax'
}

/** 행 입력을 현행 행에 펼친 입력 필드로 옮깁니다. 현행은 입력 JSON을 행에 그대로 펼쳤습니다. */
export function toLegacyInput(input: PayrollRowInput): Record<string, unknown> {
  switch (input.incomeType) {
    case 'WAGE_MONTHLY':
    case 'WAGE_HOURLY':
    case 'WAGE_DAILY':
      return {
        base_pay: input.basePay ?? 0,
        hourly_wage: input.hourlyWage ?? 0,
        daily_wage: input.dailyWage ?? 0,
        worked_days: input.workedDays ?? 0,
        prorate_requested: input.proration !== undefined,
        proration:
          input.proration === undefined
            ? null
            : { payable_days: input.proration.payableDays, total_days: input.proration.totalDays },
        payment_items: items(input.paymentItems),
        deduction_items: items(input.otherDeductions),
        work: {
          regular_hours: hours(input.work?.regularMinutes),
          overtime_hours: hours(input.work?.overtimeMinutes),
          night_hours: hours(input.work?.nightMinutes),
          holiday_hours: hours(input.work?.holidayMinutes),
          holiday_overtime_hours: hours(input.work?.holidayOvertimeMinutes),
          absence_hours: hours(input.work?.absenceMinutes),
          weekly_holiday_deduction_days: input.work?.weeklyHolidayDeductionDays ?? 0,
          weekly_holiday_weeks: input.weeklyHolidayWeeks ?? 0,
        },
        insurance_notice: insuranceNotice(input.insuranceNotice),
      }
    case 'DAILY':
      return {
        pay_amount: input.payAmount ?? 0,
        // 새 일용 행은 근무일 수만 둡니다. 근무 날짜는 없습니다.
        work_dates: [],
        work_days: input.workDays ?? null,
        avg_daily_hours: input.averageDailyMinutes === undefined ? null : hours(input.averageDailyMinutes),
        is_owner_or_cohabiting_relative: input.employmentInsuranceExempt ?? false,
        deduction_items: items(input.otherDeductions),
      }
    case 'BUSINESS':
      return {
        pay_amount: input.payAmount ?? 0,
        business_income_type_code: input.businessIncomeCode ?? null,
        detail_type: null,
        employment_insurance_applicable: input.employmentInsuranceApplicable ?? false,
        contract_type: null,
        short_term_work_dates: [],
        special_occ_type_code: null,
        tax_deduction_mode: taxDeductionMode(input),
      }
    case 'OTHER':
      return {
        pay_amount: input.payAmount ?? 0,
        other_income_type_code: input.otherIncomeCode ?? null,
        tax_deduction_mode: taxDeductionMode(input),
        necessary_expense_amount: input.necessaryExpenseAmount ?? null,
      }
  }
}

/** 계산 결과를 현행 `calculation`으로 옮깁니다. */
function toLegacyCalculation(ledger: PayrollLedger, row: PayrollRow): Record<string, unknown> | null {
  const result = row.result
  if (result === null) return null
  const employee = result.employeeInsurance
  const employer = result.employerInsurance
  return {
    type: BPO_SEGMENT[row.incomeType],
    income_type: row.incomeType.toLowerCase(),
    attribution_month: ledger.attributionMonth,
    rate_table: result.rateTable,
    gross_pay: result.grossPay,
    taxable_pay: result.taxablePay,
    non_taxable_pay: result.nonTaxablePay,
    national_pension: employee.nationalPension,
    health_insurance: employee.healthInsurance,
    long_term_care_insurance: employee.longTermCare,
    employment_insurance: employee.employmentInsurance,
    income_tax: result.incomeTax,
    local_income_tax: result.localIncomeTax,
    deduction_total: result.deductionTotal,
    net_pay: result.netPay,
    employer: {
      national_pension: employer.nationalPension,
      health_insurance: employer.healthInsurance,
      long_term_care_insurance: employer.longTermCare,
      employment_insurance: employer.employmentInsurance,
      industrial_accident_insurance: employer.industrialAccident,
      total: employer.total,
    },
    payments: result.payments.map((line) => ({
      code: line.code,
      name: line.name,
      amount: line.amount,
      taxable_amount: line.taxableAmount,
      non_taxable_amount: line.nonTaxableAmount,
      formula: line.formula,
    })),
    deductions: result.deductions.map((line) => ({
      code: line.code,
      name: line.name,
      amount: line.amount,
      formula: line.formula,
    })),
    breakdown: result.breakdown,
    warnings: result.warnings,
  }
}

/**
 * 행 하나를 현행 행으로 옮깁니다. 현행 `legacyRow`와 같은 키입니다.
 *
 * 새 행에 없는 소득자 정보(주민등록번호 가림, 외국인 여부, 부서, 이메일)는 `null`입니다. 현행 지급항목 ID 대신 새 항목 코드를
 * `item_id`와 `taxable_incomes`·`other_deductions`의 키로 씁니다.
 */
export function toLegacyRow(ledger: PayrollLedger, row: PayrollRow): Record<string, unknown> {
  const segment = legacySegment(row.incomeType)
  const result = row.result
  return {
    id: row.id,
    card_id: ledger.id,
    income_type: segment,
    legacy_income_type: segment,
    wage_type: row.incomeType.toLowerCase(),
    employee_id: row.employeeId,
    name: row.payeeName,
    resident_number: null,
    is_foreigner: null,
    residence_country: null,
    payment_date: ledger.paymentDate,
    birth_date: null,
    department: null,
    email: null,
    employment_status_label: null,
    ...toLegacyInput(row.input),
    overrides: {},
    is_manually_overridden: false,
    is_calculated: result !== null,
    calculated_at: result === null ? null : row.updatedAt,
    gross_pay: result?.grossPay ?? 0,
    taxable_pay: result?.taxablePay ?? 0,
    non_taxable_pay: result?.nonTaxablePay ?? 0,
    income_tax: result?.incomeTax ?? 0,
    local_income_tax: result?.localIncomeTax ?? 0,
    employee_insurance_total: result?.employeeInsurance.total ?? 0,
    employer_insurance_total: result?.employerInsurance.total ?? 0,
    deduction_total: result?.deductionTotal ?? 0,
    net_pay: result?.netPay ?? 0,
    calculation: toLegacyCalculation(ledger, row),
    // 지급항목은 근로 행에만 있으므로 다른 행은 빈 객체입니다.
    taxable_incomes: amountsByCode(row.input.paymentItems),
    other_deductions: amountsByCode(row.input.otherDeductions),
  }
}

/** 대장과 그 행입니다. */
export interface LedgerWithRows {
  ledger: PayrollLedger
  rows: readonly PayrollRow[]
}

/** 행을 현행 소득 구분 키(`wage_salary`, `daily`, `business`, `other_labor`)로 묶습니다. */
export function groupedRows(sources: readonly LedgerWithRows[]): Record<LegacyKey, Record<string, unknown>[]> {
  const grouped: Record<LegacyKey, Record<string, unknown>[]> = {
    wage_salary: [],
    daily: [],
    business: [],
    other_labor: [],
  }
  for (const { ledger, rows } of sources) {
    for (const row of rows) grouped[LEGACY_KEY[legacySegment(row.incomeType)]].push(toLegacyRow(ledger, row))
  }
  return grouped
}

/**
 * 현행 카드 목록 순서(귀속월 내림차순, 같은 달은 현행 `kind` 문자열 순이라 추가 카드가 먼저, 그다음 만든 순)로 정렬합니다.
 * 새 ID는 만든 순서대로 커집니다.
 */
export function legacyCardOrder(ledgers: readonly PayrollLedger[]): PayrollLedger[] {
  const kindRank = (ledger: PayrollLedger) => (ledger.kind === 'ADDITIONAL' ? 0 : 1)
  return [...ledgers].sort((a, b) => {
    if (a.attributionMonth !== b.attributionMonth) return a.attributionMonth < b.attributionMonth ? 1 : -1
    if (kindRank(a) !== kindRank(b)) return kindRank(a) - kindRank(b)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 같은 귀속월의 정기 대장 ID입니다. 추가 대장의 현행 `parent_card_id`입니다. */
export function parentCardIdOf(ledger: PayrollLedger, sameMonth: readonly PayrollLedger[]): string | null {
  if (ledger.kind === 'REGULAR') return null
  return (
    sameMonth.find((other) => other.kind === 'REGULAR' && other.attributionMonth === ledger.attributionMonth)?.id ??
    null
  )
}

/** 새 추가 대장 거절 사유 → 현행 사유입니다. */
const ADDITIONAL_REASONS: Record<string, string> = {
  NO_REGULAR_LEDGER: 'no_default_card',
  REGULAR_LEDGER_NOT_SUBMITTED: 'parent_not_calculated',
  DRAFT_LEDGER_EXISTS: 'input_card_exists',
  WITHHOLDING_DEADLINE_NEAR: 'withholding_deadline_near',
}

/**
 * 추가 대장 거절(현행 `ADDITIONAL_CARD_NOT_ALLOWED`)의 `reason`을 현행 값으로 바꿉니다. 그 밖의 오류는 그대로 둡니다.
 */
export function toLegacyAdditionalError(error: LegacyError): LegacyError {
  if (error.body.code !== 'ADDITIONAL_CARD_NOT_ALLOWED') return error
  const reason = error.body['reason']
  if (typeof reason !== 'string') return error
  return new LegacyError(error.status, { ...error.body, reason: ADDITIONAL_REASONS[reason] ?? reason.toLowerCase() })
}

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** 현행 `YYYY-MM` 값인지 봅니다. */
export function isYearMonth(value: string): boolean {
  return YEAR_MONTH.test(value)
}

/** `true`·`false` 쿼리를 읽습니다. 다른 값은 422입니다. */
export function booleanQuery(params: URLSearchParams, name: string): boolean {
  const value = params.get(name)
  if (value === null) return false
  if (value !== 'true' && value !== 'false') throw legacyErrors.invalidField(name, 'Invalid value.')
  return value === 'true'
}
