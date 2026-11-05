import type { PlainDate } from '../../../lib/plain-date.types'
import type { PayrollIncomeType, PayrollRowResult, TaxDeductionMode, WithholdingRatio } from '../engine/engine.types'
import type { YearMonth } from '../engine/rate-table.types'

/** API generation a card belongs to: BPO `급여 정산` or legacy `급여 관리`. */
export type CardGeneration = 'bpo' | 'legacy'

/** `PayrollCardKind`: the month's first card or an additional card for the same attribution month. */
export type CardKind = 'default' | 'addition'

/**
 * Lifecycle state of a payroll card (proposal, spec 3.2).
 *
 * `approved`, `payslips_sent` and `exported` all count as closed (`완료`).
 */
export type CardStatus = 'inputting' | 'calculated' | 'approval_requested' | 'approved' | 'payslips_sent' | 'exported'

/** Who acts on a card, from `c.var.access.actor`. */
export type CardActor = 'client' | 'agency'

/** BPO income segment in URLs. */
export type BpoSegment = 'wage-monthly' | 'wage-daily' | 'wage-hourly' | 'daily' | 'business' | 'other'

/** Legacy income segment in URLs and payload keys. */
export type LegacySegment = 'wage-salary' | 'daily' | 'business' | 'other-labor'

/** Payslip group segment in URLs. */
export type PayslipGroup = 'wage' | 'business' | 'daily' | 'other'

/** Payslip delivery status, mirroring `PayslipNotificationStatus`. */
export type PayslipNotificationStatus = 'in_flight' | 'success' | 'fail'

/** Row of `payroll_cards`. */
export interface CardRow {
  id: number
  company_id: string
  generation: CardGeneration
  kind: CardKind
  parent_card_id: number | null
  title: string
  attribution_month: YearMonth
  payment_date: PlainDate
  period_start: PlainDate
  period_end: PlainDate
  status: CardStatus
  approval_requested_at: string | null
  approval_requested_by: string | null
  approved_at: string | null
  approved_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  payslips_sent_at: string | null
  exported_at: string | null
  export_type: string | null
  export_reference: string | null
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Hours and days of a wage row's work sheet (`work-infos`). */
export interface WorkInfo {
  regular_hours: number
  overtime_hours: number
  night_hours: number
  holiday_hours: number
  holiday_overtime_hours: number
  absence_hours: number
  weekly_holiday_deduction_days: number
  weekly_holiday_weeks: number
}

/** A payment or deduction item amount on a row, keyed by the settings item ID. */
export interface ItemAmount {
  item_id: number
  amount: number
}

/** Insurance amounts from the agency notice (고지 금액), used when the company deducts by notice. */
export interface InsuranceNotice {
  national_pension?: number
  health_insurance?: number
  long_term_care?: number
  employment_insurance?: number
}

/** Stored input of a wage row (`wage-monthly`, `wage-daily`, `wage-hourly`). */
export interface WageInputData {
  base_pay: number
  hourly_wage: number
  daily_wage: number
  worked_days: number
  prorate_requested: boolean
  proration: { payable_days: number; total_days: number } | null
  payment_items: ItemAmount[]
  deduction_items: ItemAmount[]
  work: WorkInfo
  insurance_notice: InsuranceNotice
}

/** Stored input of a daily worker row (`daily`). */
export interface DailyInputData {
  pay_amount: number
  work_dates: PlainDate[]
  /** Work days entered as a count (엑셀 근무일수) when no dates are picked. */
  work_days: number | null
  avg_daily_hours: number | null
  is_owner_or_cohabiting_relative: boolean
  deduction_items: ItemAmount[]
}

/** Stored input of a business income row (`business`). */
export interface BusinessInputData {
  pay_amount: number
  business_income_type_code: string | null
  detail_type: 'artist' | 'special' | null
  employment_insurance_applicable: boolean
  contract_type: string | null
  short_term_work_dates: PlainDate[]
  special_occ_type_code: string | null
  tax_deduction_mode: TaxDeductionMode
}

/** Stored input of an other income row (`other`). */
export interface OtherInputData {
  pay_amount: number
  other_income_type_code: string | null
  tax_deduction_mode: TaxDeductionMode
  necessary_expense_amount: number | null
}

/** Stored input of any row. */
export type RowInputData = WageInputData | DailyInputData | BusinessInputData | OtherInputData

/** HR values copied onto a wage row by `refresh-employee-info`, so a calculation can be repeated. */
export interface EmployeeSnapshot {
  dependants: number
  children_8_to_20: number
  withholding_ratio: WithholdingRatio
  income_tax_method: 'tax_table_based' | 'manual_input'
  manual_income_tax: number | null
  insurance_enrolled: { national_pension: boolean; health_insurance: boolean; employment_insurance: boolean }
  monthly_standard_hours: number
  daily_rest_hours: number
}

/** Amounts entered by hand over the calculation; `reset-calculation` clears them. */
export interface RowOverrides {
  national_pension?: number
  health_insurance?: number
  long_term_care?: number
  employment_insurance?: number
  income_tax?: number
  local_income_tax?: number
}

/** Row of `payroll_rows`. */
export interface PayrollRowRecord {
  id: number
  company_id: string
  card_id: number
  income_type: PayrollIncomeType
  employee_id: number | null
  name: string
  registration_number_enc: string | null
  is_foreigner: 0 | 1
  residence_country: string
  payment_date: PlainDate | null
  birth_date: PlainDate | null
  department_name: string | null
  email: string | null
  employment_status_label: string | null
  input: string
  snapshot: string
  overrides: string
  result: string | null
  gross_pay: number
  taxable_pay: number
  non_taxable_pay: number
  income_tax: number
  local_income_tax: number
  employee_insurance_total: number
  employer_insurance_total: number
  deduction_total: number
  net_pay: number
  calculated_at: string | null
  created_at: string
  updated_at: string
}

/** Columns written when a row is created. */
export interface RowWrite {
  income_type: PayrollIncomeType
  employee_id: number | null
  name: string
  registration_number_enc: string | null
  is_foreigner: 0 | 1
  residence_country: string
  payment_date: PlainDate | null
  birth_date: PlainDate | null
  department_name: string | null
  email: string | null
  employment_status_label: string | null
  input: RowInputData
  snapshot: EmployeeSnapshot | Record<string, never>
}

/** Row of `payroll_payslips`. */
export interface PayslipRow {
  row_id: number
  card_id: number
  email: string | null
  payment_formulas: string
  notification_status: PayslipNotificationStatus | null
  sent_at: string | null
  fail_reason: string | null
  updated_at: string
}

/** Row of `payroll_external_integrations`. */
export interface IntegrationRow {
  company_id: string
  provider: 'shiftee'
  status: 'linked' | 'unlinked'
  external_company_id: string
  company_name: string
  representative_name: string
  admin_email: string
  linked_by: string | null
  linked_at: string
  unlinked_at: string | null
}

/** A calculated row: the engine result after manual overrides. */
export type CalculatedRow = PayrollRowResult

/** Names of card transitions, each guarded by `If-Match`. */
export type CardTransitionName =
  | 'confirmInput'
  | 'reopenInput'
  | 'requestApproval'
  | 'approve'
  | 'reject'
  | 'withdrawApprovalRequest'
  | 'cancelApproval'
  | 'sendPayslips'
  | 'exportToDesk'
  | 'legacyFix'
  | 'legacyRelease'

/** Allowed source states, target state and actors of one card transition. */
export interface CardTransitionRule {
  from: readonly CardStatus[]
  to: CardStatus
  actors: readonly CardActor[]
  /** Whether the transition reopens or recalculates the card, which a filed withholding return forbids. */
  locksOnFiledWithholding: boolean
}
