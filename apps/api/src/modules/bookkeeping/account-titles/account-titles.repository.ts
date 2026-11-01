import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type { AccountTitleRow } from './account-titles.types'

const CLASSIFIED_TABLES = ['sales_evidence', 'purchase_evidence', 'bank_transactions'] as const

/** Lists the live account titles a company sees: the Alfred defaults plus its own. */
export function listAccountTitleRows(db: DatabaseSync, companyId: string): AccountTitleRow[] {
  return queryAll<AccountTitleRow>(
    db,
    `SELECT * FROM account_titles WHERE (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL
     ORDER BY depth, sort_order, created_at, id`,
    [companyId],
  )
}

/** Finds a live account title visible to a company. */
export function findAccountTitleRow(db: DatabaseSync, companyId: string, id: string): AccountTitleRow | undefined {
  return queryOne<AccountTitleRow>(
    db,
    'SELECT * FROM account_titles WHERE id = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL',
    [id, companyId],
  )
}

/** Inserts an account title row. */
export function insertAccountTitleRow(db: DatabaseSync, row: AccountTitleRow): void {
  execute(
    db,
    `INSERT INTO account_titles (id, company_id, parent_id, depth, code, name, description, applies_to, pl_category, cash_category,
       is_system, is_auto_etc, sort_order, deleted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      row.id,
      row.company_id,
      row.parent_id,
      row.depth,
      row.code,
      row.name,
      row.description,
      row.applies_to,
      row.pl_category,
      row.cash_category,
      row.is_system,
      row.is_auto_etc,
      row.sort_order,
      row.created_at,
    ],
  )
}

/** Updates the name and description of a company account title. */
export function updateAccountTitleRow(db: DatabaseSync, companyId: string, id: string, name: string, description: string | null): void {
  execute(db, 'UPDATE account_titles SET name = ?, description = ? WHERE id = ? AND company_id = ?', [name, description, id, companyId])
}

/** Soft-deletes a company account title. */
export function softDeleteAccountTitleRow(db: DatabaseSync, companyId: string, id: string, now: string): void {
  execute(db, 'UPDATE account_titles SET deleted_at = ? WHERE id = ? AND company_id = ?', [now, id, companyId])
}

/** Counts a company's evidence and bank transactions classified into an account title. */
export function countClassifiedInto(db: DatabaseSync, companyId: string, accountTitleId: string): number {
  return CLASSIFIED_TABLES.reduce(
    (sum, table) =>
      sum +
      (queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND account_title_id = ?`, [companyId, accountTitleId])?.n ?? 0),
    0,
  )
}

/**
 * Moves a company's classifications and rule results from one account title to another.
 *
 * @returns The number of evidence and bank rows that moved.
 */
export function moveClassifications(db: DatabaseSync, companyId: string, fromId: string, toId: string): number {
  const moved = CLASSIFIED_TABLES.reduce(
    (sum, table) => sum + execute(db, `UPDATE ${table} SET account_title_id = ? WHERE company_id = ? AND account_title_id = ?`, [toId, companyId, fromId]),
    0,
  )
  execute(db, 'UPDATE classification_rules SET result_account_title_id = ? WHERE company_id = ? AND result_account_title_id = ?', [toId, companyId, fromId])
  return moved
}

/** Returns the next sort order among a parent's children. */
export function nextSortOrder(db: DatabaseSync, parentId: string): number {
  return (queryOne<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM account_titles WHERE parent_id = ?', [parentId])?.n ?? 0) + 1
}
