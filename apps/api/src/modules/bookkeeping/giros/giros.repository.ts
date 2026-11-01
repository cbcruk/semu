import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { GiroActionRow, GiroActionStatus, GiroDoneReason, GiroPaymentRow, GiroRow, GiroStatus, RegisteredBankAccount, ScrapedGiroBill } from './giros.types'

/** Lists bills with an optional status and search, excluding hidden bills unless asked for. */
export function listGiros(
  db: DatabaseSync,
  companyId: string,
  status: GiroStatus | undefined,
  search: string | undefined,
  limit: number,
  offset: number,
): { rows: GiroRow[]; count: number } {
  const conditions = ['company_id = ?', status === undefined ? "status <> 'hidden'" : 'status = ?']
  const params: SqlValue[] = status === undefined ? [companyId] : [companyId, status]
  if (search !== undefined && search.trim() !== '') {
    conditions.push('(tax_name LIKE ? OR e_pay_no LIKE ?)')
    params.push(`%${search.trim()}%`, `%${search.trim()}%`)
  }
  const where = conditions.join(' AND ')
  const rows = queryAll<GiroRow>(
    db,
    `SELECT * FROM giros WHERE ${where} ORDER BY due_date IS NULL, due_date, created_at, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM giros WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Counts a company's bills per status. */
export function countGirosByStatus(db: DatabaseSync, companyId: string): Record<GiroStatus, number> {
  const counts: Record<GiroStatus, number> = { todo: 0, unknown: 0, done: 0, hidden: 0 }
  for (const row of queryAll<{ status: GiroStatus; n: number }>(db, 'SELECT status, COUNT(*) AS n FROM giros WHERE company_id = ? GROUP BY status', [companyId])) {
    counts[row.status] = row.n
  }
  return counts
}

/** Finds a bill within a company. */
export function findGiro(db: DatabaseSync, companyId: string, id: string): GiroRow | undefined {
  return queryOne<GiroRow>(db, 'SELECT * FROM giros WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Finds a bill by its electronic payment number. */
export function findGiroByEPayNo(db: DatabaseSync, companyId: string, ePayNo: string): GiroRow | undefined {
  return queryOne<GiroRow>(db, 'SELECT * FROM giros WHERE company_id = ? AND e_pay_no = ?', [companyId, ePayNo])
}

/** Lists a company's bills in the given statuses. */
export function listGirosInStatus(db: DatabaseSync, companyId: string, statuses: readonly GiroStatus[]): GiroRow[] {
  return queryAll<GiroRow>(db, `SELECT * FROM giros WHERE company_id = ? AND status IN (${statuses.map(() => '?').join(', ')})`, [companyId, ...statuses])
}

/** Inserts a scraped bill. */
export function insertGiro(db: DatabaseSync, companyId: string, id: string, bill: ScrapedGiroBill, status: GiroStatus, doneReason: GiroDoneReason | null, now: string): void {
  execute(
    db,
    `INSERT INTO giros (id, company_id, e_pay_no, giro_type, slip_type, tax_name, bill_org_name, pay_amount, due_date, detail, status, done_reason,
       memo, status_updated_at, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    [
      id,
      companyId,
      bill.e_pay_no,
      bill.giro_type,
      bill.slip_type,
      bill.tax_name,
      bill.bill_org_name ?? null,
      bill.pay_amount,
      bill.due_date ?? null,
      JSON.stringify(bill.detail),
      status,
      doneReason,
      now,
      now,
      now,
    ],
  )
}

/** Refreshes the scraped fields of a bill without touching its status. */
export function updateGiroFields(db: DatabaseSync, id: string, bill: ScrapedGiroBill, now: string): void {
  execute(
    db,
    `UPDATE giros SET giro_type = ?, slip_type = ?, tax_name = ?, bill_org_name = ?, pay_amount = ?, due_date = ?, detail = ?, modified_at = ?
     WHERE id = ?`,
    [bill.giro_type, bill.slip_type, bill.tax_name, bill.bill_org_name ?? null, bill.pay_amount, bill.due_date ?? null, JSON.stringify(bill.detail), now, id],
  )
}

/**
 * Moves a bill to a new status when it is still in one of the expected statuses.
 *
 * @returns Whether the row changed; `false` means a concurrent change won.
 */
export function updateGiroStatus(
  db: DatabaseSync,
  id: string,
  from: readonly GiroStatus[],
  to: GiroStatus,
  doneReason: GiroDoneReason | null,
  memo: string,
  now: string,
): boolean {
  return (
    execute(
      db,
      `UPDATE giros SET status = ?, done_reason = ?, memo = ?, status_updated_at = ?, modified_at = ?
       WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`,
      [to, doneReason, memo, now, now, id, ...from],
    ) === 1
  )
}

/** Appends an entry to a bill's action history. */
export function insertGiroAction(db: DatabaseSync, giroId: string, status: GiroActionStatus, memo: string, username: string, now: string): void {
  execute(db, 'INSERT INTO giro_actions (id, giro_id, status, memo, username, approver_username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    randomUUID(),
    giroId,
    status,
    memo,
    username,
    '',
    now,
  ])
}

/** Returns the latest action of a bill. */
export function lastGiroAction(db: DatabaseSync, giroId: string): GiroActionRow | undefined {
  return queryOne<GiroActionRow>(db, 'SELECT * FROM giro_actions WHERE giro_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [giroId])
}

/** Finds an earlier payment attempt with the same idempotency key. */
export function findGiroPayment(db: DatabaseSync, giroId: string, requestId: string): GiroPaymentRow | undefined {
  return queryOne<GiroPaymentRow>(db, 'SELECT * FROM giro_payments WHERE giro_id = ? AND request_id = ?', [giroId, requestId])
}

/** Records a payment attempt in `requested` status. */
export function insertGiroPayment(db: DatabaseSync, row: Omit<GiroPaymentRow, 'status' | 'result_code' | 'result_message'>): void {
  execute(
    db,
    `INSERT INTO giro_payments (id, giro_id, request_id, bank_code, account_number_enc, account_number_tail, amount, status, requested_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
    [row.id, row.giro_id, row.request_id, row.bank_code, row.account_number_enc, row.account_number_tail, row.amount, row.requested_by, row.created_at],
  )
}

/** Settles a payment attempt with the gateway's answer. */
export function settleGiroPayment(db: DatabaseSync, id: string, succeeded: boolean, resultCode: string, resultMessage: string): void {
  execute(db, 'UPDATE giro_payments SET status = ?, result_code = ?, result_message = ? WHERE id = ?', [
    succeeded ? 'succeeded' : 'failed',
    resultCode,
    resultMessage,
    id,
  ])
}

/** Lists a company's payment attempts, newest first. */
export function listCompanyGiroPayments(db: DatabaseSync, companyId: string): GiroPaymentRow[] {
  return queryAll<GiroPaymentRow>(
    db,
    `SELECT p.* FROM giro_payments p JOIN giros g ON g.id = p.giro_id WHERE g.company_id = ? ORDER BY p.created_at DESC, p.rowid DESC`,
    [companyId],
  )
}

/** Finds a payment attempt of a company by ID. */
export function findCompanyGiroPayment(db: DatabaseSync, companyId: string, paymentId: string): GiroPaymentRow | undefined {
  return queryOne<GiroPaymentRow>(db, 'SELECT p.* FROM giro_payments p JOIN giros g ON g.id = p.giro_id WHERE g.company_id = ? AND p.id = ?', [
    companyId,
    paymentId,
  ])
}

/** Lists a company's active demand-deposit accounts. */
export function listRegisteredBankAccounts(db: DatabaseSync, companyId: string): RegisteredBankAccount[] {
  return queryAll<RegisteredBankAccount>(
    db,
    "SELECT id, bank_code, account_number_enc, account_name FROM bank_accounts WHERE company_id = ? AND is_active = 1 AND account_type = '01' ORDER BY created_at, id",
    [companyId],
  )
}

/** Finds an active registered account of a company. */
export function findRegisteredBankAccount(db: DatabaseSync, companyId: string, id: string): RegisteredBankAccount | undefined {
  return queryOne<RegisteredBankAccount>(
    db,
    'SELECT id, bank_code, account_number_enc, account_name FROM bank_accounts WHERE company_id = ? AND id = ? AND is_active = 1',
    [companyId, id],
  )
}

/** Returns the display name of a user, which is the email in the local replica. */
export function usernameOf(db: DatabaseSync, userId: string): string {
  return queryOne<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', [userId])?.email ?? userId
}
