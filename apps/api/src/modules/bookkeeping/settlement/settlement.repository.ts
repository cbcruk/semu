import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type {
  BsLineRow,
  CashEntryRow,
  CashLedgerRow,
  PartnerBalanceKind,
  PartnerBalanceRow,
  PartnerEntryRow,
  PlLineRow,
  SettlementClosingRow,
  SettlementScope,
} from './settlement.types'

/** Deletes every stored row of one scope and fiscal year, before a replacement upload. */
export function deleteScopeRows(db: DatabaseSync, companyId: string, year: number, scope: SettlementScope): void {
  switch (scope) {
    case 'pl':
      execute(db, 'DELETE FROM settlement_pl_lines WHERE company_id = ? AND year = ?', [companyId, year])
      return
    case 'bs':
      execute(db, 'DELETE FROM settlement_bs_lines WHERE company_id = ? AND target_month LIKE ?', [companyId, `${year}-%`])
      return
    case 'cash':
      execute(db, 'DELETE FROM settlement_cash_ledger WHERE company_id = ? AND year = ?', [companyId, year])
      execute(db, 'DELETE FROM settlement_cash_entries WHERE company_id = ? AND year = ?', [companyId, year])
      return
    case 'ar_ap':
      execute(db, 'DELETE FROM settlement_partner_balances WHERE company_id = ? AND year = ?', [companyId, year])
      execute(db, 'DELETE FROM settlement_partner_entries WHERE company_id = ? AND year = ?', [companyId, year])
      return
  }
}

/** Inserts or replaces the closing metadata of one scope and fiscal year. */
export function upsertClosing(db: DatabaseSync, row: SettlementClosingRow): void {
  execute(
    db,
    `INSERT INTO settlement_closings (company_id, fiscal_year, scope, closed_through, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, fiscal_year, scope) DO UPDATE SET closed_through = excluded.closed_through,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [row.company_id, row.fiscal_year, row.scope, row.closed_through, row.updated_at, row.updated_by],
  )
}

/** Finds the closing metadata of one scope and fiscal year. */
export function findClosing(db: DatabaseSync, companyId: string, year: number, scope: SettlementScope): SettlementClosingRow | undefined {
  return queryOne<SettlementClosingRow>(db, 'SELECT * FROM settlement_closings WHERE company_id = ? AND fiscal_year = ? AND scope = ?', [
    companyId,
    year,
    scope,
  ])
}

/** Lists the closings of one scope, oldest fiscal year first. */
export function listClosings(db: DatabaseSync, companyId: string, scope: SettlementScope): SettlementClosingRow[] {
  return queryAll<SettlementClosingRow>(db, 'SELECT * FROM settlement_closings WHERE company_id = ? AND scope = ? ORDER BY fiscal_year', [
    companyId,
    scope,
  ])
}

/** Inserts one profit and loss line. */
export function insertPlLine(db: DatabaseSync, companyId: string, line: PlLineRow): void {
  execute(db, 'INSERT INTO settlement_pl_lines (company_id, year, month, section, path, amount) VALUES (?, ?, ?, ?, ?, ?)', [
    companyId,
    line.year,
    line.month,
    line.section,
    line.path,
    line.amount,
  ])
}

/** Lists the profit and loss lines of a fiscal year. */
export function listPlLines(db: DatabaseSync, companyId: string, year: number): PlLineRow[] {
  return queryAll<PlLineRow>(
    db,
    'SELECT year, month, section, path, amount FROM settlement_pl_lines WHERE company_id = ? AND year = ? ORDER BY month, section, path',
    [companyId, year],
  )
}

/** Inserts one balance sheet line. */
export function insertBsLine(db: DatabaseSync, companyId: string, line: BsLineRow): void {
  execute(
    db,
    'INSERT INTO settlement_bs_lines (company_id, target_month, subject, parent_subject, sort_order, amount) VALUES (?, ?, ?, ?, ?, ?)',
    [companyId, line.target_month, line.subject, line.parent_subject, line.sort_order, line.amount],
  )
}

/** Lists the balance sheet lines of a fiscal year, by month and sort order. */
export function listBsLines(db: DatabaseSync, companyId: string, year: number): BsLineRow[] {
  return queryAll<BsLineRow>(
    db,
    `SELECT target_month, subject, parent_subject, sort_order, amount FROM settlement_bs_lines
     WHERE company_id = ? AND target_month LIKE ? ORDER BY target_month, sort_order, subject`,
    [companyId, `${year}-%`],
  )
}

/** Inserts one month of a cash-equivalent account. */
export function insertCashLedger(db: DatabaseSync, companyId: string, row: CashLedgerRow): void {
  execute(
    db,
    'INSERT INTO settlement_cash_ledger (company_id, year, month, cash_account, inflow, outflow, closing_balance) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [companyId, row.year, row.month, row.cash_account, row.inflow, row.outflow, row.closing_balance],
  )
}

/** Lists the cash-equivalent ledger months of a fiscal year. */
export function listCashLedger(db: DatabaseSync, companyId: string, year: number): CashLedgerRow[] {
  return queryAll<CashLedgerRow>(
    db,
    'SELECT year, month, cash_account, inflow, outflow, closing_balance FROM settlement_cash_ledger WHERE company_id = ? AND year = ? ORDER BY month, cash_account',
    [companyId, year],
  )
}

/** Inserts one cash ledger entry. */
export function insertCashEntry(db: DatabaseSync, companyId: string, year: number, row: CashEntryRow): void {
  execute(
    db,
    'INSERT INTO settlement_cash_entries (company_id, year, seq, date, cash_account, summary, inflow, outflow, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [companyId, year, row.seq, row.date, row.cash_account, row.summary, row.inflow, row.outflow, row.balance],
  )
}

/** Lists the cash ledger entries of a fiscal year in upload order. */
export function listCashEntries(db: DatabaseSync, companyId: string, year: number): CashEntryRow[] {
  return queryAll<CashEntryRow>(
    db,
    'SELECT seq, date, cash_account, summary, inflow, outflow, balance FROM settlement_cash_entries WHERE company_id = ? AND year = ? ORDER BY seq',
    [companyId, year],
  )
}

/** Inserts one month of a partner balance. */
export function insertPartnerBalance(db: DatabaseSync, companyId: string, row: PartnerBalanceRow): void {
  execute(
    db,
    `INSERT INTO settlement_partner_balances (company_id, kind, year, month, erp_partner_code, partner_name, summary, entry_count,
       rollover_balance, increase_amount, decrease_amount, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      row.kind,
      row.year,
      row.month,
      row.erp_partner_code,
      row.partner_name,
      row.summary,
      row.entry_count,
      row.rollover_balance,
      row.increase_amount,
      row.decrease_amount,
      row.balance,
    ],
  )
}

/** Lists the partner balance months of one kind and fiscal year. */
export function listPartnerBalances(db: DatabaseSync, companyId: string, kind: PartnerBalanceKind, year: number): PartnerBalanceRow[] {
  return queryAll<PartnerBalanceRow>(
    db,
    `SELECT kind, year, month, erp_partner_code, partner_name, summary, entry_count, rollover_balance, increase_amount, decrease_amount, balance
     FROM settlement_partner_balances WHERE company_id = ? AND kind = ? AND year = ? ORDER BY erp_partner_code, month`,
    [companyId, kind, year],
  )
}

/** Inserts one partner ledger entry. */
export function insertPartnerEntry(db: DatabaseSync, companyId: string, kind: PartnerBalanceKind, year: number, row: PartnerEntryRow): void {
  execute(
    db,
    `INSERT INTO settlement_partner_entries (company_id, kind, year, erp_partner_code, seq, date, summary, transaction_amount, balance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, kind, year, row.erp_partner_code, row.seq, row.date, row.summary, row.transaction_amount, row.balance],
  )
}

/** Lists the ledger entries of one partner, in date order. */
export function listPartnerEntries(db: DatabaseSync, companyId: string, kind: PartnerBalanceKind, year: number, partnerCode: string): PartnerEntryRow[] {
  return queryAll<PartnerEntryRow>(
    db,
    `SELECT erp_partner_code, seq, date, summary, transaction_amount, balance FROM settlement_partner_entries
     WHERE company_id = ? AND kind = ? AND year = ? AND erp_partner_code = ? ORDER BY date, seq`,
    [companyId, kind, year, partnerCode],
  )
}
