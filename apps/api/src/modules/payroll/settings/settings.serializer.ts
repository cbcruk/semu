import type { PayrollRateTable } from '../engine/rate-table.types'
import type {
  DeductionItemRow,
  DeductionSettingsRow,
  PaymentCatalogItem,
  PaymentItemRow,
  PayrollTermsRow,
  WorkConditionRow,
  WorkSchedulePolicyRow,
} from './settings.types'
import { fromX100, policyFieldsOf, scheduleHours } from './settings.utils'

/** Serializes a catalog entry of `payroll-payment-categories`. */
export function serializeCatalogItem(item: PaymentCatalogItem, rates: PayrollRateTable): Record<string, unknown> {
  const limit = item.nonTaxableCategory === null ? null : rates.nonTaxable[item.nonTaxableCategory]
  return {
    code: item.code,
    name: item.name,
    group: item.group,
    is_taxable: item.isTaxable,
    non_taxable_category: item.nonTaxableCategory,
    statutory_monthly_limit: limit?.monthlyLimit ?? null,
    statutory_annual_limit: limit?.annualLimit ?? null,
    description: item.description,
    standard_name_required: item.standardNameRequired,
    include_in_monthly_salary: item.includeInMonthlySalary,
    include_in_ordinary_wage: item.includeInOrdinaryWage,
    include_in_average_wage: item.includeInAverageWage,
    include_in_minimum_wage: item.includeInMinimumWage,
  }
}

/** Serializes a payment item. */
export function serializePaymentItem(row: PaymentItemRow, rates: PayrollRateTable): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    catalog_code: row.catalog_code,
    default_amount: row.default_amount,
    is_taxable: row.is_taxable === 1,
    non_taxable_category: row.non_taxable_category,
    statutory_non_taxable_limit: row.non_taxable_category === null ? null : rates.nonTaxable[row.non_taxable_category].monthlyLimit,
    non_taxable_limit_enabled: row.non_taxable_limit_enabled === 1,
    non_taxable_limit_amount: row.non_taxable_limit_amount,
    include_in_monthly_salary: row.include_in_monthly_salary === 1,
    include_in_ordinary_wage: row.include_in_ordinary_wage === 1,
    include_in_average_wage: row.include_in_average_wage === 1,
    include_in_minimum_wage: row.include_in_minimum_wage === 1,
    show_formula_on_payslip: row.show_formula_on_payslip === 1,
    formula_text: row.formula_text,
    is_system: row.is_system === 1,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Serializes the company deduction settings (`payroll-deduction`). */
export function serializeDeductionSettings(row: DeductionSettingsRow): Record<string, unknown> {
  return {
    national_pension_method: row.national_pension_method,
    national_pension_pay_on_acquisition_month: row.national_pension_pay_on_acquisition_month === 1,
    health_insurance_method: row.health_insurance_method,
    employment_insurance_method: row.employment_insurance_method,
    income_tax_method: row.income_tax_method,
    updated_at: row.updated_at,
  }
}

/** Serializes a deduction item. */
export function serializeDeductionItem(row: DeductionItemRow): Record<string, unknown> {
  return { id: row.id, name: row.name, amount_mode: row.amount_mode, amount: row.amount, created_at: row.created_at, updated_at: row.updated_at }
}

/** Serializes payroll terms together with the read-only minimum wage of the rate table in force. */
export function serializePayrollTerms(row: PayrollTermsRow, rates: PayrollRateTable): Record<string, unknown> {
  return {
    wage_period_start_day: row.wage_period_start_day,
    payment_month: row.payment_month,
    payment_day: row.payment_day,
    payment_method: row.payment_method,
    attendance_record_integration: row.attendance_record_integration,
    is_under_five_employees: row.is_under_five_employees === 1,
    fixed_overtime_multiplier: fromX100(row.fixed_overtime_multiplier_x100),
    fixed_night_multiplier: fromX100(row.fixed_night_multiplier_x100),
    fixed_holiday_multiplier: fromX100(row.fixed_holiday_multiplier_x100),
    fixed_holiday_overtime_multiplier: fromX100(row.fixed_holiday_overtime_multiplier_x100),
    retirement_benefit_type: row.retirement_benefit_type,
    minimum_wage: {
      year: Number(rates.effectiveFrom.slice(0, 4)),
      hourly_wage: rates.minimumWage.hourly,
      monthly_wage: rates.minimumWage.monthly,
      monthly_hours: rates.minimumWage.monthlyHours,
    },
    updated_at: row.updated_at,
  }
}

/** Serializes a work condition. */
export function serializeWorkCondition(row: WorkConditionRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    work_place: row.work_place,
    probation_months: row.probation_months,
    probation_pay_rate: row.probation_pay_rate,
    is_active: row.is_active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Serializes a work schedule policy with the hours the engine derives from it. */
export function serializeWorkSchedulePolicy(row: WorkSchedulePolicyRow): Record<string, unknown> {
  const fields = policyFieldsOf(row)
  const hours = scheduleHours(fields)
  return {
    id: row.id,
    ...fields,
    weekly_rest_hours: hours.weeklyRestHours,
    weekly_contractual_hours: hours.weeklyContractualHours,
    work_days_per_week: hours.workDaysPerWeek,
    monthly_standard_hours: hours.monthlyStandardHours,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Serializes the usage status of a work condition or work schedule policy. */
export function serializeUsageStatus(id: number, isActive: boolean, usageCount: number): Record<string, unknown> {
  return { id, is_active: isActive, usage_count: usageCount, in_use: usageCount > 0 }
}
