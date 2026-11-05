import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { placeholders, queryAll, transaction } from '../../../db/query'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { invalidField, notFound } from '../../../lib/domain-error'
import { maskTail } from '../../../lib/masking'
import { assertAssignable, loadAccountTitleIndex } from '../account-titles/account-titles.service'
import type { AccountTitleInfo } from '../account-titles/account-titles.types'
import { EVIDENCE_TABLE, evidenceAmounts } from '../evidence/evidence.utils'
import { requirePartner } from '../partners/partners.repository'
import {
  type BankTransactionListRow,
  deleteSettlementLinks,
  findBankAccountRow,
  findBankTransactionRow,
  listBalanceSnapshots,
  listBankAccountRows,
  listBankTransactionRows,
  listSettlementLinks,
  refreshSettlementStatuses,
  settledAmountOf,
  summarizeBankTransactions,
  updateBankAccountSettings,
  updateBankTransactionManual,
  upsertSettlementLink,
} from './bank.repository'
import type { BankAccount, BankAccountRow, BankAccountSummary, BankTransaction, BankTransactionFilter, SettlementLink, SettlementStatus } from './bank.types'
import { ASSET_BUCKET } from './bank.utils'

/** Lists bank accounts with the 총 자산 / 총 부채 summary of the account list screen. */
export function listBankAccounts(deps: ServiceDeps, companyId: string, includeInactive: boolean): { summary: BankAccountSummary; accounts: BankAccount[] } {
  const rows = listBankAccountRows(deps.db, companyId, includeInactive)
  const summary: BankAccountSummary = {
    account_count: rows.filter((row) => row.is_active === 1).length,
    total_assets: 0,
    assets_by_type: { demand: 0, foreign_currency: 0, savings: 0, fund: 0, trust: 0, insurance: 0, pension: 0 },
    total_liabilities: 0,
  }
  for (const row of rows) {
    if (row.is_active === 0) continue
    const balance = row.balance ?? 0
    if (row.account_type === '41') {
      summary.total_liabilities += Math.abs(balance)
      continue
    }
    summary.total_assets += balance
    summary.assets_by_type[ASSET_BUCKET[row.account_type]] += balance
  }
  return { summary, accounts: rows.map((row) => serializeBankAccount(row, deps.cipher)) }
}

/** Changes a bank account's alias and whether the cash reports include it. */
export function updateBankAccount(
  deps: ServiceDeps,
  companyId: string,
  id: string,
  patch: { account_name?: string | null | undefined; is_visible_on_cash_report?: boolean | undefined },
): BankAccount {
  const row = findBankAccountRow(deps.db, companyId, id)
  if (row === undefined) throw notFound('Bank account')
  updateBankAccountSettings(
    deps.db,
    companyId,
    id,
    patch.account_name === undefined ? row.account_name : patch.account_name,
    patch.is_visible_on_cash_report ?? row.is_visible_on_cash_report === 1,
    deps.clock.now(),
  )
  const updated = findBankAccountRow(deps.db, companyId, id)
  if (updated === undefined) throw notFound('Bank account')
  return serializeBankAccount(updated, deps.cipher)
}

/** Lists the stored daily closing balances of one account. */
export function listDailyBalances(
  db: DatabaseSync,
  companyId: string,
  accountId: string,
  start: string,
  end: string,
): { account_id: string; results: { date: string; closing_balance: number; source: 'scrap' | 'derived' }[] } {
  if (findBankAccountRow(db, companyId, accountId) === undefined) throw notFound('Bank account')
  return { account_id: accountId, results: listBalanceSnapshots(db, accountId, start, end) }
}

/** Lists bank transactions with the deposit, withdrawal and net totals and the classification tab counts. */
export function listBankTransactions(
  db: DatabaseSync,
  companyId: string,
  filter: BankTransactionFilter,
  sort: string,
  page: { limit: number; offset: number },
): { rows: BankTransaction[]; count: number; totals: { deposit: number; withdrawal: number; net: number }; counts: { all: number; classified: number; unclassified: number } } {
  const titles = loadAccountTitleIndex(db, companyId)
  const summary = summarizeBankTransactions(db, companyId, filter)
  return {
    rows: listBankTransactionRows(db, companyId, filter, sort, page).map((row) => serializeBankTransaction(row, titles)),
    count: summary.count,
    totals: { deposit: summary.deposit, withdrawal: summary.withdrawal, net: summary.deposit + summary.withdrawal },
    counts: summary.counts,
  }
}

/** Lists every bank transaction matching a filter, for export. */
export function exportBankTransactions(db: DatabaseSync, companyId: string, filter: BankTransactionFilter, sort: string): BankTransaction[] {
  const titles = loadAccountTitleIndex(db, companyId)
  return listBankTransactionRows(db, companyId, filter, sort, null).map((row) => serializeBankTransaction(row, titles))
}

/**
 * Classifies a bank transaction by hand and sets its partner and memo.
 *
 * Choosing an account title marks the row `manual`; clearing it returns the
 * row to unclassified. The 증빙 연결 status is recomputed afterwards.
 */
export function patchBankTransaction(
  deps: ServiceDeps,
  companyId: string,
  id: string,
  patch: { account_title_id?: string | null | undefined; partner_id?: string | null | undefined; memo?: string | null | undefined },
): BankTransaction {
  return transaction(deps.db, () => {
    const row = findBankTransactionRow(deps.db, companyId, id)
    if (row === undefined) throw notFound('Bank transaction')
    applyManual(deps.db, companyId, row.id, row.direction, patch, row)
    return getBankTransaction(deps.db, companyId, id)
  })
}

/** Classifies many bank transactions at once. */
export function bulkClassifyBankTransactions(
  deps: ServiceDeps,
  companyId: string,
  input: { ids: string[]; account_title_id?: string | null | undefined; partner_id?: string | null | undefined },
): { updated: number } {
  return transaction(deps.db, () => {
    const rows = queryAll<{ id: string; direction: 'deposit' | 'withdrawal'; account_title_id: string | null; classified_by: 'manual' | 'rule' | null; classified_rule_id: string | null; partner_id: string | null; memo: string | null }>(
      deps.db,
      `SELECT id, direction, account_title_id, classified_by, classified_rule_id, partner_id, memo FROM bank_transactions WHERE company_id = ? AND id IN (${placeholders(input.ids.length)})`,
      [companyId, ...input.ids],
    )
    if (rows.length !== new Set(input.ids).size) throw invalidField('ids', 'Some bank transactions do not exist.')
    for (const row of rows) applyManual(deps.db, companyId, row.id, row.direction, input, row)
    return { updated: rows.length }
  })
}

/**
 * Links a bank transaction to the evidence it settles, replacing amounts for evidence already linked.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the linked total exceeds the transaction amount,
 * a link exceeds the evidence's remaining amount, or the evidence belongs to another partner.
 */
export function linkSettlements(
  deps: ServiceDeps,
  companyId: string,
  id: string,
  links: { evidence_side: 'sales' | 'purchase'; evidence_id: string; amount: number }[],
): { links: SettlementLink[]; settlement_status: SettlementStatus } {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const tx = findBankTransactionRow(deps.db, companyId, id)
    if (tx === undefined) throw notFound('Bank transaction')
    const expectedSide = tx.direction === 'deposit' ? 'sales' : 'purchase'
    for (const link of links) {
      if (link.evidence_side !== expectedSide) throw invalidField('evidence_side', `A ${tx.direction} settles ${expectedSide} evidence.`)
      const evidence = queryAll<{ partner_id: string | null; total_amount: number | null; supply_amount: number | null; vat_amount: number | null }>(
        deps.db,
        `SELECT partner_id, total_amount, supply_amount, vat_amount FROM ${EVIDENCE_TABLE[link.evidence_side]} WHERE company_id = ? AND id = ?`,
        [companyId, link.evidence_id],
      )[0]
      if (evidence === undefined) throw invalidField('evidence_id', 'Unknown evidence.')
      if (tx.partner_id !== null && evidence.partner_id !== null && tx.partner_id !== evidence.partner_id) {
        throw invalidField('evidence_id', 'The evidence belongs to another partner.')
      }
      const otherLinks = settledAmountOf(deps.db, companyId, link.evidence_side, link.evidence_id) - currentLinkAmount(deps.db, companyId, id, link.evidence_id)
      if (otherLinks + link.amount > Math.abs(evidenceAmounts(evidence).total)) throw invalidField('amount', 'The amount exceeds what remains unsettled.')
      upsertSettlementLink(deps.db, companyId, { id: randomUUID(), bank_transaction_id: id, ...link, created_at: now })
    }
    const total = listSettlementLinks(deps.db, companyId, id).reduce((sum, link) => sum + link.amount, 0)
    if (total > Math.abs(tx.amount)) throw invalidField('amount', 'Linked amounts exceed the transaction amount.')
    return settlementResult(deps.db, companyId, id)
  })
}

/** Removes settlement links of a bank transaction, all of them unless an evidence ID is given. */
export function unlinkSettlements(deps: ServiceDeps, companyId: string, id: string, evidenceId?: string): { links: SettlementLink[]; settlement_status: SettlementStatus } {
  return transaction(deps.db, () => {
    if (findBankTransactionRow(deps.db, companyId, id) === undefined) throw notFound('Bank transaction')
    deleteSettlementLinks(deps.db, companyId, id, evidenceId)
    return settlementResult(deps.db, companyId, id)
  })
}

/** Converts a bank account row to its wire shape, masking the number. */
export function serializeBankAccount(row: BankAccountRow, cipher: Cipher): BankAccount {
  return {
    id: row.id,
    integration_id: row.integration_id,
    bank_code: row.bank_code,
    account_number: maskTail(cipher.decrypt(row.account_number_enc), 6),
    account_name: row.account_name,
    account_type: row.account_type,
    is_corporate: row.is_corporate === 1,
    currency_code: row.currency_code,
    holder: row.holder,
    open_date: row.open_date,
    end_date: row.end_date,
    balance: row.balance ?? 0,
    balance_fx: row.balance_fx,
    fx_rate: row.fx_rate,
    is_dormant: row.is_dormant === 1,
    is_active: row.is_active === 1,
    is_visible_on_cash_report: row.is_visible_on_cash_report === 1,
    last_transaction_date: row.last_transaction_date,
  }
}

/** Converts a joined bank transaction row to its wire shape. */
export function serializeBankTransaction(row: BankTransactionListRow, titles: ReadonlyMap<string, AccountTitleInfo>): BankTransaction {
  return {
    id: row.id,
    account_id: row.account_id,
    bank_code: row.bank_code,
    account_number_tail: row.account_number_tail,
    account_name: row.account_name,
    transacted_at: row.transacted_at,
    direction: row.direction,
    amount: row.amount,
    balance_after: row.balance_after,
    summary: row.summary,
    currency_code: row.currency_code,
    amount_fx: row.amount_fx,
    account_title_id: row.account_title_id,
    account_title_name: row.account_title_id === null ? null : (titles.get(row.account_title_id)?.name ?? null),
    classified_by: row.classified_by,
    classified_rule_id: row.classified_rule_id,
    partner_id: row.partner_id,
    partner_name: row.partner_name,
    memo: row.memo,
    settlement_status: row.settlement_status,
    settled_amount: row.settled_amount,
  }
}

function applyManual(
  db: DatabaseSync,
  companyId: string,
  id: string,
  direction: 'deposit' | 'withdrawal',
  patch: { account_title_id?: string | null | undefined; partner_id?: string | null | undefined; memo?: string | null | undefined },
  current: { account_title_id: string | null; classified_by: 'manual' | 'rule' | null; classified_rule_id: string | null; partner_id: string | null; memo: string | null },
): void {
  if (patch.account_title_id !== undefined && patch.account_title_id !== null) assertAssignable(db, companyId, patch.account_title_id, direction)
  if (patch.partner_id !== undefined && patch.partner_id !== null) requirePartner(db, companyId, patch.partner_id)
  if (patch.memo !== undefined && patch.memo !== null && patch.memo.length > 50) throw invalidField('memo', 'Use at most 50 characters.')
  const accountChanged = patch.account_title_id !== undefined
  updateBankTransactionManual(db, companyId, id, {
    accountTitleId: accountChanged ? (patch.account_title_id ?? null) : current.account_title_id,
    classifiedBy: accountChanged ? (patch.account_title_id === null ? null : 'manual') : current.classified_by,
    ruleId: accountChanged ? null : current.classified_rule_id,
    partnerId: patch.partner_id === undefined ? current.partner_id : patch.partner_id,
    memo: patch.memo === undefined ? current.memo : patch.memo,
  })
  refreshSettlementStatuses(db, companyId, loadAccountTitleIndex(db, companyId), [id])
}

/** Returns one bank transaction in wire shape. */
export function getBankTransaction(db: DatabaseSync, companyId: string, id: string): BankTransaction {
  const row = queryAll<BankTransactionListRow>(
    db,
    `SELECT t.*, a.bank_code, a.account_number_tail, a.account_name, p.name AS partner_name,
       COALESCE((SELECT SUM(l.amount) FROM settlement_links l WHERE l.bank_transaction_id = t.id), 0) AS settled_amount
     FROM bank_transactions t JOIN bank_accounts a ON a.company_id = t.company_id AND a.id = t.account_id
     LEFT JOIN partners p ON p.id = t.partner_id WHERE t.company_id = ? AND t.id = ?`,
    [companyId, id],
  )[0]
  if (row === undefined) throw notFound('Bank transaction')
  return serializeBankTransaction(row, loadAccountTitleIndex(db, companyId))
}

function currentLinkAmount(db: DatabaseSync, companyId: string, txId: string, evidenceId: string): number {
  return listSettlementLinks(db, companyId, txId).find((link) => link.evidence_id === evidenceId)?.amount ?? 0
}

function settlementResult(db: DatabaseSync, companyId: string, id: string): { links: SettlementLink[]; settlement_status: SettlementStatus } {
  refreshSettlementStatuses(db, companyId, loadAccountTitleIndex(db, companyId), [id])
  const tx = findBankTransactionRow(db, companyId, id)
  return { links: listSettlementLinks(db, companyId, id), settlement_status: tx?.settlement_status ?? 'not_applicable' }
}
