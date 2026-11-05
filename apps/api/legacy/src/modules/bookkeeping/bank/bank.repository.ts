import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { AccountTitleInfo } from '../account-titles/account-titles.types'
import type { BankAccountRow, BankTransactionFilter, BankTransactionRow, SettlementLink } from './bank.types'
import { settlementStatusOf } from './bank.utils'

/** A bank transaction row joined with the names the list shows. */
export type BankTransactionListRow = BankTransactionRow & {
  bank_code: string
  account_number_tail: string
  account_name: string | null
  partner_name: string | null
  settled_amount: number
}

const TX_SORTS: Record<string, string> = {
  transacted_at: 't.transacted_at ASC, t.id ASC',
  '-transacted_at': 't.transacted_at DESC, t.id DESC',
  amount: 't.amount ASC, t.id ASC',
  '-amount': 't.amount DESC, t.id DESC',
}

/** Lists a company's bank accounts, active ones only unless asked otherwise. */
export function listBankAccountRows(db: DatabaseSync, companyId: string, includeInactive: boolean): BankAccountRow[] {
  return queryAll<BankAccountRow>(
    db,
    `SELECT * FROM bank_accounts WHERE company_id = ? ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY account_type, bank_code, created_at, id`,
    [companyId],
  )
}

/** Finds a bank account of a company. */
export function findBankAccountRow(db: DatabaseSync, companyId: string, id: string): BankAccountRow | undefined {
  return queryOne<BankAccountRow>(db, 'SELECT * FROM bank_accounts WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Finds a bank account by bank code and hashed number. */
export function findBankAccountByDigest(db: DatabaseSync, companyId: string, bankCode: string, digest: string): BankAccountRow | undefined {
  return queryOne<BankAccountRow>(db, 'SELECT * FROM bank_accounts WHERE company_id = ? AND bank_code = ? AND account_number_digest = ?', [
    companyId,
    bankCode,
    digest,
  ])
}

/** Inserts a bank account row. */
export function insertBankAccountRow(db: DatabaseSync, row: BankAccountRow): void {
  const columns = Object.keys(row) as (keyof BankAccountRow)[]
  execute(db, `INSERT INTO bank_accounts (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`, columns.map((column) => row[column]))
}

/** Updates the scraped attributes of a bank account. */
export function updateBankAccountScraped(db: DatabaseSync, row: BankAccountRow): void {
  execute(
    db,
    `UPDATE bank_accounts SET integration_id = ?, account_name = COALESCE(account_name, ?), account_type = ?, is_corporate = ?, currency_code = ?,
       holder = ?, open_date = ?, end_date = ?, balance = ?, balance_fx = ?, fx_rate = ?, is_dormant = ?, is_active = ?,
       last_transaction_date = ?, external_key = ?, updated_at = ?
     WHERE company_id = ? AND id = ?`,
    [
      row.integration_id,
      row.account_name,
      row.account_type,
      row.is_corporate,
      row.currency_code,
      row.holder,
      row.open_date,
      row.end_date,
      row.balance,
      row.balance_fx,
      row.fx_rate,
      row.is_dormant,
      row.is_active,
      row.last_transaction_date,
      row.external_key,
      row.updated_at,
      row.company_id,
      row.id,
    ],
  )
}

/** Updates the user-editable alias and cash report visibility of a bank account. */
export function updateBankAccountSettings(
  db: DatabaseSync,
  companyId: string,
  id: string,
  accountName: string | null,
  visible: boolean,
  now: string,
): void {
  execute(db, 'UPDATE bank_accounts SET account_name = ?, is_visible_on_cash_report = ?, updated_at = ? WHERE company_id = ? AND id = ?', [
    accountName,
    visible ? 1 : 0,
    now,
    companyId,
    id,
  ])
}

/** Records the closing balance of an account on a date; scraped balances win over derived ones. */
export function upsertBalanceSnapshot(db: DatabaseSync, accountId: string, date: string, closingBalance: number, source: 'scrap' | 'derived'): void {
  execute(
    db,
    `INSERT INTO bank_balance_snapshots (account_id, date, closing_balance, source) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, date) DO UPDATE SET closing_balance = excluded.closing_balance, source = excluded.source
     WHERE excluded.source = 'scrap' OR bank_balance_snapshots.source = 'derived'`,
    [accountId, date, closingBalance, source],
  )
}

/** Lists the stored daily closing balances of an account within a range. */
export function listBalanceSnapshots(
  db: DatabaseSync,
  accountId: string,
  start: string,
  end: string,
): { date: string; closing_balance: number; source: 'scrap' | 'derived' }[] {
  return queryAll(db, 'SELECT date, closing_balance, source FROM bank_balance_snapshots WHERE account_id = ? AND date BETWEEN ? AND ? ORDER BY date', [
    accountId,
    start,
    end,
  ])
}

/** Returns an account's closing balance on a date: the latest snapshot on or before it, or 0 before the first one. */
export function closingBalanceOn(db: DatabaseSync, accountId: string, date: string): number {
  return (
    queryOne<{ closing_balance: number }>(
      db,
      'SELECT closing_balance FROM bank_balance_snapshots WHERE account_id = ? AND date <= ? ORDER BY date DESC LIMIT 1',
      [accountId, date],
    )?.closing_balance ?? 0
  )
}

/** Lists bank transactions matching a filter, joined with names and settled amounts. */
export function listBankTransactionRows(
  db: DatabaseSync,
  companyId: string,
  filter: BankTransactionFilter,
  sort: string,
  page: { limit: number; offset: number } | null,
): BankTransactionListRow[] {
  const { where, params } = transactionWhere(companyId, filter)
  const limit = page === null ? '' : 'LIMIT ? OFFSET ?'
  return queryAll<BankTransactionListRow>(
    db,
    `SELECT t.*, a.bank_code, a.account_number_tail, a.account_name, p.name AS partner_name,
       COALESCE((SELECT SUM(l.amount) FROM settlement_links l WHERE l.bank_transaction_id = t.id), 0) AS settled_amount
     FROM bank_transactions t
     JOIN bank_accounts a ON a.company_id = t.company_id AND a.id = t.account_id
     LEFT JOIN partners p ON p.id = t.partner_id
     WHERE ${where} ORDER BY ${TX_SORTS[sort] ?? TX_SORTS['-transacted_at']} ${limit}`,
    page === null ? params : [...params, page.limit, page.offset],
  )
}

/** Totals and classification counts of the bank transactions matching a filter. */
export function summarizeBankTransactions(
  db: DatabaseSync,
  companyId: string,
  filter: BankTransactionFilter,
): { count: number; deposit: number; withdrawal: number; counts: { all: number; classified: number; unclassified: number } } {
  const { where, params } = transactionWhere(companyId, filter)
  const totals = queryOne<{ n: number; deposit: number; withdrawal: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) AS deposit,
       COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0) AS withdrawal
     FROM bank_transactions t LEFT JOIN partners p ON p.id = t.partner_id WHERE ${where}`,
    params,
  )
  const tabs = transactionWhere(companyId, { ...filter, classification: undefined })
  const counts = queryOne<{ n: number; classified: number }>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(t.account_title_id IS NOT NULL), 0) AS classified
     FROM bank_transactions t LEFT JOIN partners p ON p.id = t.partner_id WHERE ${tabs.where}`,
    tabs.params,
  )
  const all = counts?.n ?? 0
  const classified = counts?.classified ?? 0
  return {
    count: totals?.n ?? 0,
    deposit: totals?.deposit ?? 0,
    withdrawal: totals?.withdrawal ?? 0,
    counts: { all, classified, unclassified: all - classified },
  }
}

/** Finds a bank transaction of a company. */
export function findBankTransactionRow(db: DatabaseSync, companyId: string, id: string): BankTransactionRow | undefined {
  return queryOne<BankTransactionRow>(db, 'SELECT * FROM bank_transactions WHERE company_id = ? AND id = ?', [companyId, id])
}

/** Writes a manual classification, partner and memo onto a bank transaction. */
export function updateBankTransactionManual(
  db: DatabaseSync,
  companyId: string,
  id: string,
  values: { accountTitleId: string | null; classifiedBy: 'manual' | 'rule' | null; ruleId: string | null; partnerId: string | null; memo: string | null },
): void {
  execute(
    db,
    'UPDATE bank_transactions SET account_title_id = ?, classified_by = ?, classified_rule_id = ?, partner_id = ?, memo = ? WHERE company_id = ? AND id = ?',
    [values.accountTitleId, values.classifiedBy, values.ruleId, values.partnerId, values.memo, companyId, id],
  )
}

/** Recomputes the 증빙 연결 status of bank transactions, all of the company's when `ids` is omitted. */
export function refreshSettlementStatuses(db: DatabaseSync, companyId: string, titles: ReadonlyMap<string, AccountTitleInfo>, ids?: readonly string[]): void {
  if (ids !== undefined && ids.length === 0) return
  const rows = queryAll<{ id: string; account_title_id: string | null; partner_id: string | null; amount: number; linked: number; settlement_status: string }>(
    db,
    `SELECT t.id, t.account_title_id, t.partner_id, t.amount, t.settlement_status,
       COALESCE((SELECT SUM(l.amount) FROM settlement_links l WHERE l.bank_transaction_id = t.id), 0) AS linked
     FROM bank_transactions t WHERE t.company_id = ? ${ids === undefined ? '' : `AND t.id IN (${placeholders(ids.length)})`}`,
    [companyId, ...(ids ?? [])],
  )
  for (const row of rows) {
    const account = row.account_title_id === null ? undefined : titles.get(row.account_title_id)
    const status = settlementStatusOf(account, row.partner_id, row.amount, row.linked)
    if (status !== row.settlement_status) execute(db, 'UPDATE bank_transactions SET settlement_status = ? WHERE id = ?', [status, row.id])
  }
}

/** Lists the settlement links of a bank transaction. */
export function listSettlementLinks(db: DatabaseSync, companyId: string, bankTransactionId: string): SettlementLink[] {
  return queryAll<SettlementLink>(
    db,
    'SELECT id, bank_transaction_id, evidence_side, evidence_id, amount, created_at FROM settlement_links WHERE company_id = ? AND bank_transaction_id = ? ORDER BY created_at, id',
    [companyId, bankTransactionId],
  )
}

/** Adds or replaces the link between a bank transaction and one evidence record. */
export function upsertSettlementLink(db: DatabaseSync, companyId: string, link: SettlementLink): void {
  execute(
    db,
    `INSERT INTO settlement_links (id, company_id, bank_transaction_id, evidence_side, evidence_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (bank_transaction_id, evidence_side, evidence_id) DO UPDATE SET amount = excluded.amount`,
    [link.id, companyId, link.bank_transaction_id, link.evidence_side, link.evidence_id, link.amount, link.created_at],
  )
}

/**
 * Removes settlement links of a bank transaction.
 *
 * @param evidenceId Removes only the link to this evidence; every link when omitted.
 */
export function deleteSettlementLinks(db: DatabaseSync, companyId: string, bankTransactionId: string, evidenceId?: string): number {
  return evidenceId === undefined
    ? execute(db, 'DELETE FROM settlement_links WHERE company_id = ? AND bank_transaction_id = ?', [companyId, bankTransactionId])
    : execute(db, 'DELETE FROM settlement_links WHERE company_id = ? AND bank_transaction_id = ? AND evidence_id = ?', [companyId, bankTransactionId, evidenceId])
}

/** Sums the amounts linked to one evidence record across all bank transactions. */
export function settledAmountOf(db: DatabaseSync, companyId: string, side: 'sales' | 'purchase', evidenceId: string): number {
  return (
    queryOne<{ total: number }>(
      db,
      'SELECT COALESCE(SUM(amount), 0) AS total FROM settlement_links WHERE company_id = ? AND evidence_side = ? AND evidence_id = ?',
      [companyId, side, evidenceId],
    )?.total ?? 0
  )
}

function transactionWhere(companyId: string, filter: BankTransactionFilter): { where: string; params: SqlValue[] } {
  const conditions = ['t.company_id = ?', 'substr(t.transacted_at, 1, 10) BETWEEN ? AND ?']
  const params: SqlValue[] = [companyId, filter.start, filter.end]
  if (filter.direction !== undefined) {
    conditions.push('t.direction = ?')
    params.push(filter.direction)
  }
  if (filter.accountIds.length > 0) {
    conditions.push(`t.account_id IN (${placeholders(filter.accountIds.length)})`)
    params.push(...filter.accountIds)
  }
  if (filter.accountTitleIds.length > 0) {
    conditions.push(`t.account_title_id IN (${placeholders(filter.accountTitleIds.length)})`)
    params.push(...filter.accountTitleIds)
  }
  if (filter.classification === 'classified') conditions.push('t.account_title_id IS NOT NULL')
  if (filter.classification === 'unclassified') conditions.push('t.account_title_id IS NULL')
  if (filter.partnerId !== undefined) {
    conditions.push('t.partner_id = ?')
    params.push(filter.partnerId)
  }
  if (filter.search !== undefined && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    conditions.push("(t.summary LIKE ? OR t.memo LIKE ? OR COALESCE(p.name, '') LIKE ?)")
    params.push(term, term, term)
  }
  return { where: conditions.join(' AND '), params }
}
