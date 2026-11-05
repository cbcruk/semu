import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import type { MemoHistoryRow, MemoRow } from './memo.types'

/** Finds an employee's memo, or `undefined` when it is empty. */
export function findMemo(db: DatabaseSync, companyId: string, employeeId: number): MemoRow | undefined {
  return queryOne<MemoRow>(db, 'SELECT content, updated_by, updated_at FROM employee_memos WHERE company_id = ? AND employee_id = ?', [companyId, employeeId])
}

/** Replaces an employee's memo and records the change. */
export function saveMemo(db: DatabaseSync, companyId: string, employeeId: number, content: string, userId: string, now: string): void {
  transaction(db, () => {
    execute(
      db,
      `INSERT INTO employee_memos (company_id, employee_id, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (company_id, employee_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [companyId, employeeId, content, userId, now],
    )
    insertHistory(db, companyId, employeeId, 'updated', content, userId, now)
  })
}

/** Clears an employee's memo, recording the deletion when there was one. */
export function clearMemo(db: DatabaseSync, companyId: string, employeeId: number, userId: string, now: string): void {
  transaction(db, () => {
    if (execute(db, 'DELETE FROM employee_memos WHERE company_id = ? AND employee_id = ?', [companyId, employeeId]) > 0) {
      insertHistory(db, companyId, employeeId, 'deleted', null, userId, now)
    }
  })
}

/** Lists a page of an employee's memo history, newest first. */
export function listMemoHistories(db: DatabaseSync, companyId: string, employeeId: number, limit: number, offset: number): { rows: MemoHistoryRow[]; count: number } {
  const rows = queryAll<MemoHistoryRow>(
    db,
    'SELECT id, action, content, created_by, created_at FROM employee_memo_histories WHERE company_id = ? AND employee_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [companyId, employeeId, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM employee_memo_histories WHERE company_id = ? AND employee_id = ?', [companyId, employeeId])
  return { rows, count: total?.n ?? 0 }
}

function insertHistory(db: DatabaseSync, companyId: string, employeeId: number, action: MemoHistoryRow['action'], content: string | null, userId: string, now: string): void {
  execute(db, 'INSERT INTO employee_memo_histories (company_id, employee_id, action, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    companyId,
    employeeId,
    action,
    content,
    userId,
    now,
  ])
}
