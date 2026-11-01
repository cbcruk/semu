import { z } from 'zod'

const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')
const name = z.string().trim().min(1).max(50)
const dayOfWeek = z.number().int().min(0).max(6)
const hundredths = (max: number): z.ZodNumber =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'Use at most two decimal places.')
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true')

/** Query string of the settings lists. */
export const listQuery = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  is_active: booleanQuery.optional(),
})

/** Query string of the payment item list. */
export const paymentItemListQuery = listQuery.extend({
  is_taxable: booleanQuery.optional(),
  search: z.string().max(50).optional(),
})

/** Query string of the payment catalog (`payroll-payment-categories`). */
export const catalogQuery = z.object({
  search: z.string().max(50).optional(),
  is_taxable: booleanQuery.optional(),
  group: z.enum(['base', 'overtime', 'fixed_overtime', 'leave', 'bonus', 'allowance', 'non_taxable']).optional(),
})

/** Body of a new payment item. Fields left out take the catalog entry's values, or custom defaults. */
export const paymentItemCreateBody = z.object({
  name,
  source: z.enum(['catalog', 'custom']),
  catalog_code: z.string().min(1).max(50).nullable().optional(),
  default_amount: won.nullable().optional(),
  is_taxable: z.boolean().optional(),
  non_taxable_limit_enabled: z.boolean().optional(),
  non_taxable_limit_amount: won.nullable().optional(),
  include_in_monthly_salary: z.boolean().optional(),
  include_in_ordinary_wage: z.boolean().optional(),
  include_in_average_wage: z.boolean().optional(),
  include_in_minimum_wage: z.boolean().optional(),
  show_formula_on_payslip: z.boolean().optional(),
  formula_text: z.string().max(500).nullable().optional(),
})

/** Body of a payment item update; every field is optional. */
export const paymentItemPatchBody = paymentItemCreateBody.partial()

/** Body of the company deduction settings update (`payroll-deduction`). */
export const deductionSettingsBody = z.object({
  national_pension_method: z.enum(['notice', 'rate']).optional(),
  national_pension_pay_on_acquisition_month: z.boolean().optional(),
  health_insurance_method: z.enum(['notice', 'rate']).optional(),
  employment_insurance_method: z.enum(['notice', 'rate']).optional(),
  income_tax_method: z.enum(['tax_table_based', 'manual_input', 'none']).optional(),
})

/** Body of a new deduction item. */
export const deductionItemCreateBody = z.object({
  name,
  amount_mode: z.enum(['fixed', 'on_settlement']),
  amount: won.nullable().optional(),
})

/** Body of a deduction item update. */
export const deductionItemPatchBody = deductionItemCreateBody.partial()

/** Body of the payroll terms update (`payroll-terms`). */
export const payrollTermsBody = z.object({
  wage_period_start_day: z.number().int().min(1).max(31).optional(),
  payment_month: z.enum(['current', 'next', 'previous']).optional(),
  payment_day: z.number().int().min(1).max(31).optional(),
  payment_method: z.enum(['bank_transfer', 'cash_payment']).optional(),
  attendance_record_integration: z.enum(['none', 'manual_input']).optional(),
  is_under_five_employees: z.boolean().optional(),
  fixed_overtime_multiplier: hundredths(10).optional(),
  fixed_night_multiplier: hundredths(10).optional(),
  fixed_holiday_multiplier: hundredths(10).optional(),
  fixed_holiday_overtime_multiplier: hundredths(10).optional(),
  retirement_benefit_type: z.enum(['grant', 'pension_db', 'pension_dc']).optional(),
})

/** Body of a new work condition. */
export const workConditionCreateBody = z.object({
  name,
  work_place: z.string().trim().max(200).optional(),
  probation_months: z.number().int().min(0).max(12).optional(),
  probation_pay_rate: z.number().int().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
})

/** Body of a work condition update. */
export const workConditionPatchBody = workConditionCreateBody.partial()

/** Body of a usage status change. */
export const usageStatusBody = z.object({ is_active: z.boolean() })

/** Body of a work schedule policy, used for both create and full replacement (PUT). */
export const workSchedulePolicyBody = z.object({
  name,
  paid_weekly_holidays: z.array(dayOfWeek).max(7),
  unpaid_holidays: z.array(dayOfWeek).max(7),
  contractual_work_schedule_type: z.enum(['weekly', 'biweekly', 'monthly']),
  contractual_work_schedules: z
    .array(z.object({ week: z.number().int().min(1).max(5), day_of_week: dayOfWeek, hours: hundredths(24) }))
    .max(35),
  weekly_rest_hours_input_method: z.enum(['auto_calculated', 'manual']),
  weekly_rest_hours: hundredths(8).nullable().optional(),
  fixed_overtime_work_schedule_type: z.enum(['none', 'daily', 'weekly', 'monthly']),
  fixed_overtime_input_type: z.enum(['none', 'actual', 'additional']),
  fixed_overtime_items: z
    .array(
      z.object({
        work_type: z.enum(['extended', 'night', 'holiday', 'holiday_extended']),
        day_of_week: dayOfWeek.nullable().optional(),
        hours: hundredths(300),
      }),
    )
    .max(28)
    .optional(),
  is_active: z.boolean().optional(),
})
