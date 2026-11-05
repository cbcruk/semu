import { invalidField } from '../../../lib/domain-error'
import { addDays, addMonths } from '../../../lib/plain-date'
import { toFlag } from '../shared/hr.utils'
import type { DeductionInfoWrite, DeductionInput } from './deduction.types'
import { INCOME_TAX_REDUCTION_REASONS } from './income-tax-reduction-reasons'

/**
 * Validates deduction input against the reduction rules and converts it to column values.
 *
 * A reduction needs an application type, a period within the statutory years
 * and a rate its reason allows; the reason's own rate fills a missing one.
 */
export function toDeductionWrite(input: DeductionInput): DeductionInfoWrite {
  if (input.income_tax_calc_method === 'manual_input' && input.manual_income_tax === null) {
    throw invalidField('manual_income_tax', 'Enter the income tax amount.')
  }
  const reducing = input.income_tax_reduction_type !== 'none'
  let reasonCode: string | null = null
  let rate: number | null = null
  if (reducing) {
    const reasons = INCOME_TAX_REDUCTION_REASONS.filter((reason) => reason.type === input.income_tax_reduction_type)
    const reason = reasons.find((candidate) => candidate.code === input.income_tax_reduction_reason) ?? (reasons.length === 1 ? reasons[0] : undefined)
    if (reason === undefined) throw invalidField('income_tax_reduction_reason', 'Choose a reduction reason of this type.')
    if (input.income_tax_reduction_application_type === '') throw invalidField('income_tax_reduction_application_type', 'Choose how the reduction is applied.')
    const start = input.income_tax_reduction_start_date
    const end = input.income_tax_reduction_end_date
    if (start === null || end === null) throw invalidField('income_tax_reduction_start_date', 'Enter the reduction period.')
    if (end < start) throw invalidField('income_tax_reduction_end_date', 'The end date must not be before the start date.')
    if (end > addDays(addMonths(start, reason.period_years * 12), -1)) {
      throw invalidField('income_tax_reduction_end_date', `The reduction lasts at most ${reason.period_years} years.`)
    }
    const allowedRates = reasons.map((candidate) => candidate.rate)
    if (input.income_tax_reduction_rate !== null && !allowedRates.includes(input.income_tax_reduction_rate)) {
      throw invalidField('income_tax_reduction_rate', `Use one of ${allowedRates.join(', ')}.`)
    }
    reasonCode = reason.code
    rate = input.income_tax_reduction_rate ?? reason.rate
  }
  if (input.student_loan_applied && (input.student_loan_monthly_amount === null || input.student_loan_start_date === null)) {
    throw invalidField('student_loan_monthly_amount', 'Enter the monthly repayment and its start date.')
  }
  return {
    income_tax_calc_method: input.income_tax_calc_method,
    manual_income_tax: input.income_tax_calc_method === 'manual_input' ? input.manual_income_tax : null,
    income_tax_rate: input.income_tax_rate,
    income_tax_reduction_type: input.income_tax_reduction_type,
    income_tax_reduction_application_type: reducing ? input.income_tax_reduction_application_type : '',
    income_tax_reduction_reason: reasonCode,
    income_tax_reduction_start_date: reducing ? input.income_tax_reduction_start_date : null,
    income_tax_reduction_end_date: reducing ? input.income_tax_reduction_end_date : null,
    income_tax_reduction_rate: rate,
    income_tax_reduction_scope: reducing ? input.income_tax_reduction_scope : null,
    student_loan_applied: toFlag(input.student_loan_applied),
    student_loan_monthly_amount: input.student_loan_applied ? input.student_loan_monthly_amount : null,
    student_loan_start_date: input.student_loan_applied ? input.student_loan_start_date : null,
    student_loan_end_date: input.student_loan_applied ? input.student_loan_end_date : null,
  }
}
