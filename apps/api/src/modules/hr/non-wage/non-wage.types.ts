import type { EmployeeKind } from '../shared/hr.types'

/** An employee kind other than `wage-salary`. */
export type NonWageKind = Exclude<EmployeeKind, 'wage-salary'>

/** A row of `employee_non_wage_details`. */
export interface NonWageDetailRow {
  company_id: string
  employee_id: number
  leave_date: string | null
  daily_wage: number | null
  business_code: string | null
  other_income_code: string | null
  bank_code: string | null
  account_number_enc: string | null
  account_holder: string | null
  updated_at: string
}

/** Column values of `employee_non_wage_details` written by an edit. */
export type NonWageDetailWrite = Omit<NonWageDetailRow, 'company_id' | 'employee_id' | 'updated_at'>
