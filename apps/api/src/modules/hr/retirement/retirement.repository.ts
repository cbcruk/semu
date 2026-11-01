import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../../db/query'
import type { RetirementInfoRow, RetirementInfoWrite, SeveranceSettlementStatus } from './retirement.types'

/** Finds an employee's retirement settings and leaving record, or `undefined` before any is saved. */
export function findRetirementInfo(db: DatabaseSync, companyId: string, employeeId: number): RetirementInfoRow | undefined {
  return queryOne<RetirementInfoRow>(db, 'SELECT * FROM employee_retirement_infos WHERE company_id = ? AND employee_id = ?', [companyId, employeeId])
}

/** Inserts or replaces the form-editable retirement columns, keeping the settlement status. */
export function upsertRetirementInfo(db: DatabaseSync, companyId: string, employeeId: number, values: RetirementInfoWrite, now: string): void {
  const entries = Object.entries(values)
  const columns = entries.map(([key]) => key)
  execute(
    db,
    `INSERT INTO employee_retirement_infos (company_id, employee_id, updated_at, ${columns.join(', ')})
     VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT (company_id, employee_id) DO UPDATE SET updated_at = excluded.updated_at, ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}`,
    [companyId, employeeId, now, ...entries.map(([, value]) => value as string | number | null)],
  )
}

/** Clears the leaving record (퇴직 취소) while keeping the benefit settings. */
export function clearLeaving(db: DatabaseSync, companyId: string, employeeId: number, now: string): void {
  execute(
    db,
    `UPDATE employee_retirement_infos SET leave_date = NULL, leaving_reason = NULL, leaving_detail_reason = NULL, severance_amount = NULL,
       severance_settlement_status = NULL, updated_at = ? WHERE company_id = ? AND employee_id = ?`,
    [now, companyId, employeeId],
  )
}

/**
 * Records leaving reasons chosen on a signed resignation letter without setting the leave date.
 *
 * Existing reasons are kept, so an administrator's choice wins over the letter.
 */
export function draftLeavingReason(db: DatabaseSync, companyId: string, employeeId: number, reason: string, detail: string | null, now: string): void {
  execute(
    db,
    `INSERT INTO employee_retirement_infos (company_id, employee_id, leaving_reason, leaving_detail_reason, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (company_id, employee_id) DO UPDATE SET
       leaving_reason = COALESCE(employee_retirement_infos.leaving_reason, excluded.leaving_reason),
       leaving_detail_reason = COALESCE(employee_retirement_infos.leaving_detail_reason, excluded.leaving_detail_reason),
       updated_at = excluded.updated_at`,
    [companyId, employeeId, reason, detail, now],
  )
}

/**
 * Sets an employee's severance settlement status; payroll calls this from its severance screen.
 *
 * A `completed` settlement blocks deleting the employee and cancelling the retirement (`RETIREMENT_COMPLETED`).
 *
 * @returns Whether the employee has a retirement record to update.
 */
export function setSeveranceSettlementStatus(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  status: SeveranceSettlementStatus | null,
  now: string,
): boolean {
  return (
    execute(db, 'UPDATE employee_retirement_infos SET severance_settlement_status = ?, updated_at = ? WHERE company_id = ? AND employee_id = ?', [
      status,
      now,
      companyId,
      employeeId,
    ]) > 0
  )
}
