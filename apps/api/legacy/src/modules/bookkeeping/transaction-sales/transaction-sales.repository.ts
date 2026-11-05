import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type {
  IssuedInvoiceRow,
  SalesTransactionFilters,
  SalesTransactionInput,
  SalesTransactionItemRow,
  SalesTransactionListRow,
} from './transaction-sales.types'

const INVOICE_COUNT = "(SELECT COUNT(*) FROM issued_invoices i WHERE i.transaction_id = t.id AND i.status = 'issued')"
const SORT_SQL: Record<string, string> = {
  created: 't.created_at ASC, t.id',
  '-created': 't.created_at DESC, t.id',
  write_date: 't.write_date ASC, t.created_at',
  '-write_date': 't.write_date DESC, t.created_at DESC',
  grand_total_amount: 't.grand_total_amount ASC, t.created_at',
  '-grand_total_amount': 't.grand_total_amount DESC, t.created_at DESC',
}

function whereOf(companyId: string, filters: SalesTransactionFilters): { where: string; params: SqlValue[] } {
  const conditions = ['t.company_id = ?', 't.deleted_at IS NULL']
  const params: SqlValue[] = [companyId]
  if (filters.startDate !== undefined) {
    conditions.push('t.write_date >= ?')
    params.push(filters.startDate)
  }
  if (filters.endDate !== undefined) {
    conditions.push('t.write_date <= ?')
    params.push(filters.endDate)
  }
  if (filters.search !== undefined && filters.search.trim() !== '') {
    const like = `%${filters.search.trim()}%`
    conditions.push(
      `(json_extract(t.buyer, '$.company_name') LIKE ? OR json_extract(t.buyer, '$.representative_name') LIKE ?
        OR EXISTS (SELECT 1 FROM sales_transaction_items s WHERE s.transaction_id = t.id AND s.name LIKE ?))`,
    )
    params.push(like, like, like)
  }
  if (filters.isIssued !== undefined) conditions.push(filters.isIssued ? `${INVOICE_COUNT} > 0` : `${INVOICE_COUNT} = 0`)
  if (filters.issueInvoiceType !== undefined) {
    conditions.push("EXISTS (SELECT 1 FROM issued_invoices i WHERE i.transaction_id = t.id AND i.status = 'issued' AND i.issue_type = ?)")
    params.push(filters.issueInvoiceType)
  }
  if (filters.invoiceType !== undefined) {
    conditions.push('t.class_code = ?')
    params.push(filters.invoiceType)
  }
  return { where: conditions.join(' AND '), params }
}

/** Lists a company's statements with their issued invoice counts. */
export function listTransactions(
  db: DatabaseSync,
  companyId: string,
  filters: SalesTransactionFilters,
  sort: string,
  limit: number,
  offset: number,
): { rows: SalesTransactionListRow[]; count: number } {
  const { where, params } = whereOf(companyId, filters)
  const rows = queryAll<SalesTransactionListRow>(
    db,
    `SELECT t.*, ${INVOICE_COUNT} AS invoice_count FROM sales_transactions t WHERE ${where}
     ORDER BY ${SORT_SQL[sort] ?? SORT_SQL['-created']} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM sales_transactions t WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Sums statement and issued amounts over the filtered statements. */
export function summarizeTransactions(
  db: DatabaseSync,
  companyId: string,
  filters: SalesTransactionFilters,
): { transaction_count: number; transaction_amount: number; issued_count: number; issued_amount: number } {
  const { where, params } = whereOf(companyId, filters)
  const row = queryOne<{ transaction_count: number; transaction_amount: number; issued_count: number; issued_amount: number }>(
    db,
    `SELECT COUNT(*) AS transaction_count, COALESCE(SUM(grand_total_amount), 0) AS transaction_amount,
       COALESCE(SUM(CASE WHEN invoice_count > 0 THEN 1 ELSE 0 END), 0) AS issued_count,
       COALESCE(SUM(CASE WHEN invoice_count > 0 THEN grand_total_amount ELSE 0 END), 0) AS issued_amount
     FROM (SELECT t.grand_total_amount, ${INVOICE_COUNT} AS invoice_count FROM sales_transactions t WHERE ${where})`,
    params,
  )
  return row ?? { transaction_count: 0, transaction_amount: 0, issued_count: 0, issued_amount: 0 }
}

/** Finds a live statement with its issued invoice count. */
export function findTransaction(db: DatabaseSync, companyId: string, id: string): SalesTransactionListRow | undefined {
  return queryOne<SalesTransactionListRow>(
    db,
    `SELECT t.*, ${INVOICE_COUNT} AS invoice_count FROM sales_transactions t WHERE t.company_id = ? AND t.id = ? AND t.deleted_at IS NULL`,
    [companyId, id],
  )
}

/** Lists the item rows of a statement in order. */
export function listItems(db: DatabaseSync, transactionId: string): SalesTransactionItemRow[] {
  return queryAll<SalesTransactionItemRow>(db, 'SELECT * FROM sales_transaction_items WHERE transaction_id = ? ORDER BY seq', [transactionId])
}

/** Inserts a statement and its items. */
export function insertTransaction(db: DatabaseSync, companyId: string, id: string, input: SalesTransactionInput, now: string): void {
  execute(
    db,
    `INSERT INTO sales_transactions (id, company_id, partner_id, class_code, kind_code, buyer_class_code, purpose, write_date, description,
       cash, check_bill, note, crit, supplier, buyer, grand_total_amount, charge_total_amount, tax_total_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      companyId,
      input.partner_id,
      input.class_code,
      input.kind_code,
      input.buyer_class_code,
      input.purpose,
      input.write_date,
      input.description,
      input.cash,
      input.check_bill,
      input.note,
      input.crit,
      JSON.stringify(input.supplier),
      JSON.stringify(input.buyer),
      input.grand_total_amount,
      input.charge_total_amount,
      input.tax_total_amount,
      now,
      now,
    ],
  )
  insertItems(db, id, input)
}

/** Replaces a statement's fields and items. */
export function updateTransaction(db: DatabaseSync, companyId: string, id: string, input: SalesTransactionInput, now: string): void {
  execute(
    db,
    `UPDATE sales_transactions SET partner_id = ?, class_code = ?, kind_code = ?, buyer_class_code = ?, purpose = ?, write_date = ?,
       description = ?, cash = ?, check_bill = ?, note = ?, crit = ?, supplier = ?, buyer = ?, grand_total_amount = ?,
       charge_total_amount = ?, tax_total_amount = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`,
    [
      input.partner_id,
      input.class_code,
      input.kind_code,
      input.buyer_class_code,
      input.purpose,
      input.write_date,
      input.description,
      input.cash,
      input.check_bill,
      input.note,
      input.crit,
      JSON.stringify(input.supplier),
      JSON.stringify(input.buyer),
      input.grand_total_amount,
      input.charge_total_amount,
      input.tax_total_amount,
      now,
      companyId,
      id,
    ],
  )
  execute(db, 'DELETE FROM sales_transaction_items WHERE transaction_id = ?', [id])
  insertItems(db, id, input)
}

/** Soft-deletes a statement. */
export function deleteTransaction(db: DatabaseSync, companyId: string, id: string, now: string): void {
  execute(db, 'UPDATE sales_transactions SET deleted_at = ?, updated_at = ? WHERE company_id = ? AND id = ?', [now, now, companyId, id])
}

function insertItems(db: DatabaseSync, transactionId: string, input: SalesTransactionInput): void {
  input.items.forEach((item, index) => {
    execute(
      db,
      `INSERT INTO sales_transaction_items (id, transaction_id, seq, month, day, name, specification, quantity, unit_price, supply_amount, tax_amount, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        transactionId,
        index + 1,
        item.month,
        item.day,
        item.name,
        item.specification,
        item.quantity,
        item.unit_price,
        item.supply_amount,
        item.tax_amount,
        item.description,
      ],
    )
  })
}

/** Lists a statement's issue attempts, newest first. */
export function listInvoices(db: DatabaseSync, transactionId: string): IssuedInvoiceRow[] {
  return queryAll<IssuedInvoiceRow>(db, 'SELECT * FROM issued_invoices WHERE transaction_id = ? ORDER BY created_at DESC, rowid DESC', [transactionId])
}

/** Finds an issue attempt of a statement. */
export function findInvoice(db: DatabaseSync, companyId: string, transactionId: string, invoiceId: string): IssuedInvoiceRow | undefined {
  return queryOne<IssuedInvoiceRow>(db, 'SELECT * FROM issued_invoices WHERE company_id = ? AND transaction_id = ? AND id = ?', [
    companyId,
    transactionId,
    invoiceId,
  ])
}

/** Records a new issue attempt in `issuing` status. */
export function insertIssuingInvoice(db: DatabaseSync, companyId: string, transactionId: string, id: string, snapshot: string, now: string): void {
  execute(
    db,
    `INSERT INTO issued_invoices (id, company_id, transaction_id, issue_type, status, snapshot, created_at, updated_at)
     VALUES (?, ?, ?, 'normal', 'issuing', ?, ?, ?)`,
    [id, companyId, transactionId, snapshot, now, now],
  )
}

/** Marks an issue attempt as issued with its NTS approval number. */
export function markInvoiceIssued(db: DatabaseSync, id: string, issueNo: string, issueDatetime: string, now: string): void {
  execute(db, "UPDATE issued_invoices SET status = 'issued', issue_no = ?, issue_datetime = ?, updated_at = ? WHERE id = ?", [
    issueNo,
    issueDatetime,
    now,
    id,
  ])
}

/** Marks an issue attempt as failed with the rejection reason. */
export function markInvoiceFailed(db: DatabaseSync, id: string, errorCode: string, errorMessage: string, now: string): void {
  execute(db, "UPDATE issued_invoices SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?", [
    errorCode,
    errorMessage,
    now,
    id,
  ])
}

/** Marks an issued invoice's detail as synced. */
export function markInvoiceSynced(db: DatabaseSync, id: string, now: string): void {
  execute(db, 'UPDATE issued_invoices SET is_detail_synced = 1, updated_at = ? WHERE id = ?', [now, id])
}

/** Links collected tax invoice evidence with the same approval number to its statement. */
export function linkEvidenceToTransaction(db: DatabaseSync, companyId: string, transactionId: string, issueNo: string): number {
  return execute(
    db,
    `UPDATE sales_evidence SET sales_transaction_id = ?
     WHERE company_id = ? AND source = 'tax_invoice' AND (external_key = ? OR approval_no = ?) AND sales_transaction_id IS NULL`,
    [transactionId, companyId, issueNo, issueNo],
  )
}

/** Checks whether a live partner belongs to the company. */
export function partnerExists(db: DatabaseSync, companyId: string, partnerId: string): boolean {
  return queryOne<{ found: number }>(db, 'SELECT 1 AS found FROM partners WHERE company_id = ? AND id = ? AND deleted_at IS NULL', [companyId, partnerId]) !== undefined
}
