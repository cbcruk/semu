import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll } from '../../../db/query'

/** Kind of 4대보험 report an HR event creates. */
export type InsuranceFilingKind = 'join' | 'leave' | 'dependent' | 'leave_of_absence' | 'reinstatement'

/** A queued 4대보험 report, the normalised form of the legacy `employee_work` flags. */
export interface InsuranceFilingRow {
  id: number
  company_id: string
  employee_id: number
  kind: InsuranceFilingKind
  status: 'pending' | 'done' | 'failed' | 'withdrawn'
  source_type: string | null
  source_id: number | null
  payload: string | null
  result_msg: string | null
  requested_at: string
  processed_at: string | null
}

/**
 * Queues a 4대보험 report for the agency staff who file it.
 *
 * A pending report of the same kind and source is replaced, so editing a leave twice queues one report.
 */
export function enqueueInsuranceFiling(
  db: DatabaseSync,
  values: { companyId: string; employeeId: number; kind: InsuranceFilingKind; sourceType: string | null; sourceId: number | null; payload: object; now: string },
): void {
  withdrawInsuranceFilings(db, values.companyId, values.employeeId, values.kind, values.sourceType, values.sourceId, values.now)
  execute(
    db,
    `INSERT INTO employee_insurance_filings (company_id, employee_id, kind, source_type, source_id, payload, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [values.companyId, values.employeeId, values.kind, values.sourceType, values.sourceId, JSON.stringify(values.payload), values.now],
  )
}

/** Withdraws pending reports for a source that was deleted or replaced. */
export function withdrawInsuranceFilings(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  kind: InsuranceFilingKind,
  sourceType: string | null,
  sourceId: number | null,
  now: string,
): void {
  execute(
    db,
    `UPDATE employee_insurance_filings SET status = 'withdrawn', processed_at = ?
     WHERE company_id = ? AND employee_id = ? AND kind = ? AND status = 'pending' AND source_type IS ? AND source_id IS ?`,
    [now, companyId, employeeId, kind, sourceType, sourceId],
  )
}

/** Lists an employee's reports, newest first. */
export function listInsuranceFilings(db: DatabaseSync, companyId: string, employeeId: number): InsuranceFilingRow[] {
  return queryAll<InsuranceFilingRow>(db, 'SELECT * FROM employee_insurance_filings WHERE company_id = ? AND employee_id = ? ORDER BY id DESC', [
    companyId,
    employeeId,
  ])
}
