import type { NonTaxableCategory } from '../engine/rate-table.types'

/** Group of a payment catalog item, used to filter the "불러오기" modal. */
export type PaymentCatalogGroup = 'base' | 'overtime' | 'fixed_overtime' | 'leave' | 'bonus' | 'allowance' | 'non_taxable'

/** A standard payment item offered by `payroll-payment-categories` ("항목 불러오기"). */
export interface PaymentCatalogItem {
  code: string
  name: string
  group: PaymentCatalogGroup
  isTaxable: boolean
  nonTaxableCategory: NonTaxableCategory | null
  description: string
  /** Whether a company item created from this entry must keep the standard name (세무사랑 code mapping). */
  standardNameRequired: boolean
  includeInMonthlySalary: boolean
  includeInOrdinaryWage: boolean
  includeInAverageWage: boolean
  includeInMinimumWage: boolean
}

/** Row of `payroll_payment_items`. */
export interface PaymentItemRow {
  id: number
  company_id: string
  name: string
  source: 'catalog' | 'custom'
  catalog_code: string | null
  default_amount: number | null
  is_taxable: 0 | 1
  non_taxable_category: NonTaxableCategory | null
  non_taxable_limit_enabled: 0 | 1
  non_taxable_limit_amount: number | null
  include_in_monthly_salary: 0 | 1
  include_in_ordinary_wage: 0 | 1
  include_in_average_wage: 0 | 1
  include_in_minimum_wage: 0 | 1
  show_formula_on_payslip: 0 | 1
  formula_text: string | null
  is_system: 0 | 1
  sort_order: number
  created_at: string
  updated_at: string
}

/** Editable fields of a payment item after defaults are applied. */
export interface PaymentItemFields {
  name: string
  source: 'catalog' | 'custom'
  catalog_code: string | null
  default_amount: number | null
  is_taxable: boolean
  non_taxable_limit_enabled: boolean
  non_taxable_limit_amount: number | null
  include_in_monthly_salary: boolean
  include_in_ordinary_wage: boolean
  include_in_average_wage: boolean
  include_in_minimum_wage: boolean
  show_formula_on_payslip: boolean
  formula_text: string | null
}

/** Row of `payroll_deduction_items`. */
export interface DeductionItemRow {
  id: number
  company_id: string
  name: string
  amount_mode: 'fixed' | 'on_settlement'
  amount: number | null
  created_at: string
  updated_at: string
}

/** Social insurance deduction method in company settings. */
export type InsuranceMethod = 'notice' | 'rate'

/** Row of `payroll_deduction_settings` (`payroll-deduction`). */
export interface DeductionSettingsRow {
  company_id: string
  national_pension_method: InsuranceMethod
  national_pension_pay_on_acquisition_month: 0 | 1
  health_insurance_method: InsuranceMethod
  employment_insurance_method: InsuranceMethod
  income_tax_method: 'tax_table_based' | 'manual_input' | 'none'
  updated_at: string
}

/** Row of `payroll_terms`. */
export interface PayrollTermsRow {
  company_id: string
  wage_period_start_day: number
  payment_month: 'current' | 'next' | 'previous'
  payment_day: number
  payment_method: 'bank_transfer' | 'cash_payment'
  attendance_record_integration: 'none' | 'manual_input'
  is_under_five_employees: 0 | 1
  fixed_overtime_multiplier_x100: number
  fixed_night_multiplier_x100: number
  fixed_holiday_multiplier_x100: number
  fixed_holiday_overtime_multiplier_x100: number
  retirement_benefit_type: 'grant' | 'pension_db' | 'pension_dc'
  updated_at: string
}

/** Row of `work_conditions`. */
export interface WorkConditionRow {
  id: number
  company_id: string
  name: string
  work_place: string
  probation_months: number
  probation_pay_rate: number
  is_active: 0 | 1
  created_at: string
  updated_at: string
}

/** Contractual work hours of one day in a schedule cycle. */
export interface ScheduleEntry {
  /** Week of the cycle, starting at 1. */
  week: number
  /** `DAY_OF_WEEK`: Monday = 0 … Sunday = 6. */
  day_of_week: number
  hours: number
}

/** Fixed overtime hours of a work schedule policy (고정 시간외 근로). */
export interface FixedOvertimeItem {
  work_type: 'extended' | 'night' | 'holiday' | 'holiday_extended'
  /** Day for `daily` schedules; `null` for weekly and monthly totals. */
  day_of_week: number | null
  hours: number
}

/** Editable fields of a work schedule policy. */
export interface WorkSchedulePolicyFields {
  name: string
  paid_weekly_holidays: number[]
  unpaid_holidays: number[]
  contractual_work_schedule_type: 'weekly' | 'biweekly' | 'monthly'
  contractual_work_schedules: ScheduleEntry[]
  weekly_rest_hours_input_method: 'auto_calculated' | 'manual'
  weekly_rest_hours: number | null
  fixed_overtime_work_schedule_type: 'none' | 'daily' | 'weekly' | 'monthly'
  fixed_overtime_input_type: 'none' | 'actual' | 'additional'
  fixed_overtime_items: FixedOvertimeItem[]
  is_active: boolean
}

/** Row of `work_schedule_policies`. */
export interface WorkSchedulePolicyRow {
  id: number
  company_id: string
  name: string
  paid_weekly_holidays: string
  unpaid_holidays: string
  contractual_work_schedule_type: WorkSchedulePolicyFields['contractual_work_schedule_type']
  contractual_work_schedules: string
  weekly_rest_hours_input_method: WorkSchedulePolicyFields['weekly_rest_hours_input_method']
  weekly_rest_hours_x100: number | null
  fixed_overtime_work_schedule_type: WorkSchedulePolicyFields['fixed_overtime_work_schedule_type']
  fixed_overtime_input_type: WorkSchedulePolicyFields['fixed_overtime_input_type']
  fixed_overtime_items: string
  is_active: 0 | 1
  created_at: string
  updated_at: string
}

/** Hours derived from a work schedule policy by the engine. */
export interface ScheduleHours {
  weeklyContractualHours: number
  workDaysPerWeek: number
  weeklyRestHours: number
  monthlyStandardHours: number
}

/**
 * Counts where a setting is in use, so deletion can be refused and `usage-status` can report it.
 *
 * The payroll cards agent replaces {@linkcode NO_USAGE} with counts from HR
 * work contracts once employees exist.
 */
export interface SettingsUsageCounter {
  /** Number of employees or contracts that reference the work condition. */
  workConditionUsages(companyId: string, workConditionId: number): number
  /** Number of employees or contracts that reference the work schedule policy. */
  workSchedulePolicyUsages(companyId: string, policyId: number): number
}
