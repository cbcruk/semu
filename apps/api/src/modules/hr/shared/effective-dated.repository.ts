import type { DatabaseSync } from 'node:sqlite'
import { queryAll, queryOne, type SqlValue } from '../../../db/query'

/** Tables that keep one row per employee per effective date. */
export type EffectiveDatedTable = 'employee_social_insurance_infos' | 'employee_deduction_infos'

/**
 * Finds the row of an effective-dated table in force on a date.
 *
 * @returns The row with the latest `effective_from` on or before the date, or `undefined`.
 */
export function findEffectiveRow<T>(db: DatabaseSync, table: EffectiveDatedTable, companyId: string, employeeId: number, date: string): T | undefined {
  return queryOne<T>(
    db,
    `SELECT * FROM ${table} WHERE company_id = ? AND employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`,
    [companyId, employeeId, date],
  )
}

/** Lists every version of an employee's effective-dated settings, newest first. */
export function listEffectiveRows<T>(db: DatabaseSync, table: EffectiveDatedTable, companyId: string, employeeId: number): T[] {
  return queryAll<T>(db, `SELECT * FROM ${table} WHERE company_id = ? AND employee_id = ? ORDER BY effective_from DESC`, [companyId, employeeId])
}

/**
 * Saves settings effective from a date, replacing a version saved for the same date.
 *
 * Earlier versions stay so that payroll recalculations for past months read what applied then.
 */
export function saveEffectiveRow(
  db: DatabaseSync,
  table: EffectiveDatedTable,
  companyId: string,
  employeeId: number,
  effectiveFrom: string,
  values: Record<string, SqlValue>,
  updatedBy: string | null,
  now: string,
): void {
  const columns = Object.keys(values)
  queryOne(
    db,
    `INSERT INTO ${table} (company_id, employee_id, effective_from, updated_by, updated_at, ${columns.join(', ')})
     VALUES (?, ?, ?, ?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT (company_id, employee_id, effective_from) DO UPDATE SET updated_by = excluded.updated_by, updated_at = excluded.updated_at,
       ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}
     RETURNING id`,
    [companyId, employeeId, effectiveFrom, updatedBy, now, ...columns.map((column) => values[column] ?? null)],
  )
}
