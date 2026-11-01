import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne } from '../../../db/query'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { LeaveRow, LeaveWrite } from './leaves.types'

/** Lists a page of an employee's leaves, newest first. */
export function listLeaves(db: DatabaseSync, companyId: string, employeeId: number, limit: number, offset: number): { rows: LeaveRow[]; count: number } {
  const rows = queryAll<LeaveRow>(
    db,
    'SELECT * FROM employee_leaves WHERE company_id = ? AND employee_id = ? ORDER BY start_date DESC, id DESC LIMIT ? OFFSET ?',
    [companyId, employeeId, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM employee_leaves WHERE company_id = ? AND employee_id = ?', [companyId, employeeId])
  return { rows, count: total?.n ?? 0 }
}

/** Lists every leave of an employee, oldest first. */
export function listAllLeaves(db: DatabaseSync, companyId: string, employeeId: number): LeaveRow[] {
  return queryAll<LeaveRow>(db, 'SELECT * FROM employee_leaves WHERE company_id = ? AND employee_id = ? ORDER BY start_date, id', [companyId, employeeId])
}

/**
 * Lists an employee's leaves that overlap a period, such as a pay month.
 *
 * A leave ends the day before its actual return date when the employee came back early.
 */
export function listLeavesOverlapping(db: DatabaseSync, companyId: string, employeeId: number, from: PlainDate, to: PlainDate): LeaveRow[] {
  return queryAll<LeaveRow>(
    db,
    `SELECT * FROM employee_leaves WHERE company_id = ? AND employee_id = ? AND start_date <= ?
       AND COALESCE(date(actual_return_date, '-1 day'), end_date) >= ? ORDER BY start_date`,
    [companyId, employeeId, to, from],
  )
}

/** Finds one leave of an employee. */
export function findLeave(db: DatabaseSync, companyId: string, employeeId: number, leaveId: number): LeaveRow | undefined {
  return queryOne<LeaveRow>(db, 'SELECT * FROM employee_leaves WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, leaveId])
}

/** Inserts a leave and returns its ID. */
export function insertLeave(db: DatabaseSync, companyId: string, employeeId: number, values: LeaveWrite, now: string): number {
  const entries = Object.entries(values)
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO employee_leaves (company_id, employee_id, created_at, updated_at, ${entries.map(([key]) => key).join(', ')})
     VALUES (?, ?, ?, ?, ${placeholders(entries.length)}) RETURNING id`,
    [companyId, employeeId, now, now, ...entries.map(([, value]) => value as string | number | null)],
  )
  if (row === undefined) throw new Error('Leave insert returned no row.')
  return row.id
}

/** Replaces a leave's values. */
export function updateLeave(db: DatabaseSync, companyId: string, leaveId: number, values: LeaveWrite, now: string): void {
  const entries = Object.entries(values)
  execute(db, `UPDATE employee_leaves SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE company_id = ? AND id = ?`, [
    ...entries.map(([, value]) => value as string | number | null),
    now,
    companyId,
    leaveId,
  ])
}

/** Deletes a leave. */
export function deleteLeave(db: DatabaseSync, companyId: string, employeeId: number, leaveId: number): boolean {
  return execute(db, 'DELETE FROM employee_leaves WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, leaveId]) > 0
}
