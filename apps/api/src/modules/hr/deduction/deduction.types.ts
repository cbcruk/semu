import type { z } from 'zod'
import type { deductionBody } from './deduction.schema'

/** Parsed body of `PUT deduction-info` without its effective date. */
export type DeductionInput = Omit<z.infer<typeof deductionBody>, 'effective_date'>

/** Income tax reduction regime (조세특례제한법). */
export type IncomeTaxReductionType = 'none' | 'small_biz' | 'returning_korean_talent' | 'foreign_technician'

/** A row of `employee_deduction_infos`. */
export interface DeductionInfoRow {
  id: number
  company_id: string
  employee_id: number
  effective_from: string
  income_tax_calc_method: 'tax_table_based' | 'manual_input'
  manual_income_tax: number | null
  income_tax_rate: 80 | 100 | 120
  income_tax_reduction_type: IncomeTaxReductionType
  income_tax_reduction_application_type: '' | 'payroll' | 'year_end_set'
  income_tax_reduction_reason: string | null
  income_tax_reduction_start_date: string | null
  income_tax_reduction_end_date: string | null
  income_tax_reduction_rate: number | null
  income_tax_reduction_scope: 'all' | 'partial' | null
  student_loan_applied: 0 | 1
  student_loan_monthly_amount: number | null
  student_loan_start_date: string | null
  student_loan_end_date: string | null
  updated_by: string | null
  updated_at: string
}

/** Values written by the deduction form. */
export type DeductionInfoWrite = Omit<DeductionInfoRow, 'id' | 'company_id' | 'employee_id' | 'effective_from' | 'updated_by' | 'updated_at'>

/** One income tax reduction reason with its statutory rate, period and limit. */
export interface IncomeTaxReductionReason {
  type: Exclude<IncomeTaxReductionType, 'none'>
  code: string
  name: string
  rate: number
  period_years: number
  /** Yearly reduction cap in won, or `null` when uncapped. */
  annual_limit: number | null
}
