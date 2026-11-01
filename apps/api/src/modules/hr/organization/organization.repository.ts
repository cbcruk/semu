import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { invalidField } from '../../../lib/domain-error'
import { HrError } from '../shared/hr-error'
import type { OrganizationTable, OrganizationUnitInput, OrganizationUnitRow } from './organization.types'

const REFERENCE_COLUMN: Record<OrganizationTable, string> = { departments: 'department_id', positions: 'position_id' }

/** Lists a company's departments or positions in display order. */
export function listOrganizationUnits(db: DatabaseSync, table: OrganizationTable, companyId: string): OrganizationUnitRow[] {
  return queryAll<OrganizationUnitRow>(db, `SELECT * FROM ${table} WHERE company_id = ? ORDER BY sort_order, id`, [companyId])
}

/** Finds one department or position of a company. */
export function findOrganizationUnit(db: DatabaseSync, table: OrganizationTable, companyId: string, id: number): OrganizationUnitRow | undefined {
  return queryOne<OrganizationUnitRow>(db, `SELECT * FROM ${table} WHERE company_id = ? AND id = ?`, [companyId, id])
}

/** Tells whether a unit was ever assigned, through its flag or a current employee reference. */
export function isOrganizationUnitUsed(db: DatabaseSync, table: OrganizationTable, row: OrganizationUnitRow): boolean {
  if (row.is_used === 1) return true
  const reference = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND ${REFERENCE_COLUMN[table]} = ?`, [row.company_id, row.id])
  return (reference?.n ?? 0) > 0
}

/**
 * Replaces a company's departments or positions with the given list (rule R4).
 *
 * Entries with an `id` are renamed, entries without one are created, and
 * units left out are deleted. The list order becomes the display order.
 *
 * @throws {HrError} `DEPARTMENT_IN_USE` or `POSITION_IN_USE` when a left-out unit was ever assigned.
 * @throws {DomainError} `VALIDATION_FAILED` for unknown IDs or duplicate names.
 */
export function replaceOrganizationUnits(
  db: DatabaseSync,
  table: OrganizationTable,
  companyId: string,
  items: readonly OrganizationUnitInput[],
  now: string,
): OrganizationUnitRow[] {
  const names = items.map((item) => item.name.trim())
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  if (duplicate !== undefined) throw invalidField('name', `"${duplicate}" is listed more than once.`)

  return transaction(db, () => {
    const existing = listOrganizationUnits(db, table, companyId)
    const keptIds = new Set(items.flatMap((item) => (item.id === undefined ? [] : [item.id])))
    for (const id of keptIds) {
      if (!existing.some((row) => row.id === id)) throw invalidField('id', `Unknown ${table === 'departments' ? 'department' : 'position'} ${id}.`)
    }
    for (const row of existing) {
      if (keptIds.has(row.id)) continue
      if (isOrganizationUnitUsed(db, table, row)) {
        throw new HrError(table === 'departments' ? 'DEPARTMENT_IN_USE' : 'POSITION_IN_USE', `"${row.name}" has been assigned to an employee and cannot be deleted.`, {
          id: row.id,
        })
      }
      execute(db, `DELETE FROM ${table} WHERE company_id = ? AND id = ?`, [companyId, row.id])
    }
    for (const row of existing) {
      if (keptIds.has(row.id)) execute(db, `UPDATE ${table} SET name = ? WHERE company_id = ? AND id = ?`, [`#pending-rename-${row.id}`, companyId, row.id])
    }
    items.forEach((item, index) => {
      const name = item.name.trim()
      if (item.id === undefined) {
        execute(db, `INSERT INTO ${table} (company_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [companyId, name, index, now, now])
      } else {
        execute(db, `UPDATE ${table} SET name = ?, sort_order = ?, updated_at = ? WHERE company_id = ? AND id = ?`, [name, index, now, companyId, item.id])
      }
    })
    return listOrganizationUnits(db, table, companyId)
  })
}
