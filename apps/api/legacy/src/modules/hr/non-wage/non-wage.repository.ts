import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../../db/query'
import type { NonWageDetailRow, NonWageDetailWrite } from './non-wage.types'

const EMPTY_DETAIL: NonWageDetailWrite = {
  leave_date: null,
  daily_wage: null,
  business_code: null,
  other_income_code: null,
  bank_code: null,
  account_number_enc: null,
  account_holder: null,
}

/** Finds the income-specific details of a daily, business or other income earner. */
export function findNonWageDetail(db: DatabaseSync, companyId: string, employeeId: number): NonWageDetailRow | undefined {
  return queryOne<NonWageDetailRow>(db, 'SELECT * FROM employee_non_wage_details WHERE company_id = ? AND employee_id = ?', [companyId, employeeId])
}

/** Merges the given detail columns into the stored row, creating it when absent. */
export function saveNonWageDetail(db: DatabaseSync, companyId: string, employeeId: number, values: Partial<NonWageDetailWrite>, now: string): void {
  const current = findNonWageDetail(db, companyId, employeeId)
  const merged: NonWageDetailWrite = { ...EMPTY_DETAIL, ...(current ?? {}), ...values }
  execute(
    db,
    `INSERT INTO employee_non_wage_details
       (company_id, employee_id, leave_date, daily_wage, business_code, other_income_code, bank_code, account_number_enc, account_holder, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, employee_id) DO UPDATE SET
       leave_date = excluded.leave_date, daily_wage = excluded.daily_wage, business_code = excluded.business_code,
       other_income_code = excluded.other_income_code, bank_code = excluded.bank_code,
       account_number_enc = excluded.account_number_enc, account_holder = excluded.account_holder, updated_at = excluded.updated_at`,
    [
      companyId,
      employeeId,
      merged.leave_date,
      merged.daily_wage,
      merged.business_code,
      merged.other_income_code,
      merged.bank_code,
      merged.account_number_enc,
      merged.account_holder,
      now,
    ],
  )
}
