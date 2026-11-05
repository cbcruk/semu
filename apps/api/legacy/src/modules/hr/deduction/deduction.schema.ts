import { z } from 'zod'
import { nullableDate, nullableText, nullableWon } from '../shared/hr.schema'

/** Body of `PUT deduction-info`; `effective_date` defaults to today (신규 설계). */
export const deductionBody = z.object({
  income_tax_calc_method: z.enum(['tax_table_based', 'manual_input']).default('tax_table_based'),
  manual_income_tax: nullableWon,
  income_tax_rate: z.union([z.literal(80), z.literal(100), z.literal(120)]).default(100),
  income_tax_reduction_type: z.enum(['none', 'small_biz', 'returning_korean_talent', 'foreign_technician']).default('none'),
  income_tax_reduction_application_type: z.enum(['', 'payroll', 'year_end_set']).default(''),
  income_tax_reduction_reason: nullableText(50),
  income_tax_reduction_start_date: nullableDate,
  income_tax_reduction_end_date: nullableDate,
  income_tax_reduction_rate: z.number().int().min(1).max(100).nullable().optional().transform((value) => value ?? null),
  income_tax_reduction_scope: z.enum(['all', 'partial']).nullable().optional().transform((value) => value ?? null),
  student_loan_applied: z.boolean().default(false),
  student_loan_monthly_amount: nullableWon,
  student_loan_start_date: nullableDate,
  student_loan_end_date: nullableDate,
  effective_date: nullableDate,
})
