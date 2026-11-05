import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { isPlainDate } from '../../../lib/plain-date'
import {
  findBankAccountByDigest,
  insertBankAccountRow,
  updateBankAccountScraped,
  upsertBalanceSnapshot,
} from '../bank/bank.repository'
import type { BankAccountRow } from '../bank/bank.types'
import { accountNumberDigest, accountNumberTail } from '../bank/bank.utils'
import { classifyNewRows } from '../classification/classification.service'
import { upsertScrapedGiros } from '../giros/giros.service'
import { findPartnerIdByBusinessNumber } from '../partners/partners.repository'
import type {
  IngestContext,
  IngestCounts,
  IngestResult,
  ScrapedBankAccount,
  ScrapedBankTransaction,
  ScrapedCardTransaction,
  ScrapedPurchaseEvidence,
  ScrapedRecord,
  ScrapedSalesEvidence,
} from './ingestion.types'

/**
 * Normalizes scraped evidence, card, bank and giro records into the bookkeeping tables.
 *
 * - **Idempotent.** Evidence upserts on `(company, source, external_key)`,
 *   bank transactions on `(company, account, external_key)` and accounts on
 *   the hashed account number, so replaying a batch changes nothing.
 * - **Scraped fields only.** Re-collected rows refresh amounts and
 *   counterparty data but keep the user's classification, partner and memo.
 * - **New rows** are linked to partners by business number and classified by
 *   the first matching visible rule (`fill_empty`).
 * - **Balances.** Account balances and `bank_balance` records become scraped
 *   daily closings; the last `balance_after` of a day becomes a derived one.
 *
 * Evidence and bank rows are written in one transaction; giro bills follow in
 * their own. Call it outside any open transaction.
 *
 * @example Storing a hometax sales invoice twice
 * ```ts
 * import { ingestScrapedRecords } from './ingest-scraped-records'
 *
 * const record = {
 *   kind: 'sales_evidence',
 *   source: 'tax_invoice',
 *   external_key: '20261105-41000000-00000001',
 *   issued_on: '2026-11-05',
 *   total_amount: 1_100_000,
 *   supply_amount: 1_000_000,
 *   vat_amount: 100_000,
 * } as const
 * ingestScrapedRecords(db, 'c-corp', [record], { now, cipher }).sales_evidence // { inserted: 1, updated: 0 }
 * ingestScrapedRecords(db, 'c-corp', [record], { now, cipher }).sales_evidence // { inserted: 0, updated: 1 }
 * ```
 */
export function ingestScrapedRecords(db: DatabaseSync, companyId: string, records: readonly ScrapedRecord[], context: IngestContext): IngestResult {
  const result = transaction(db, () => applyScrapedRecords(db, companyId, records, context))
  if (records.some((record) => record.kind === 'giro_bills')) {
    const bills = records.flatMap((record) => (record.kind === 'giro_bills' ? record.bills : []))
    result.giros = upsertScrapedGiros(db, companyId, bills, context.now)
  }
  return result
}

/**
 * Stores evidence, card and bank records inside the caller's transaction, skipping giro bills.
 *
 * {@linkcode ingestScrapedRecords} wraps this in a transaction; seeders that
 * already hold one call it directly.
 */
export function applyScrapedRecords(db: DatabaseSync, companyId: string, records: readonly ScrapedRecord[], context: IngestContext): IngestResult {
  const result: IngestResult = {
    sales_evidence: counts(),
    purchase_evidence: counts(),
    bank_accounts: counts(),
    bank_transactions: counts(),
    bank_balances: 0,
    giros: null,
    classified: { sales: 0, purchase: 0, bank: 0 },
    rejected: [],
  }
  const inserted = { sales: [] as string[], purchase: [] as string[], bank: [] as string[] }
  const touchedDays = new Map<string, Set<string>>()
  const ordered = [...records.entries()].sort(([, a], [, b]) => kindOrder(a) - kindOrder(b))
  for (const [index, record] of ordered) {
    const reject = (reason: string): void => {
      result.rejected.push({ index, reason })
    }
    switch (record.kind) {
      case 'sales_evidence':
        if (!isPlainDate(record.issued_on)) reject('issued_on must be YYYY-MM-DD.')
        else tally(result.sales_evidence, inserted.sales, upsertSales(db, companyId, record, context.now))
        break
      case 'purchase_evidence':
        if (!isPlainDate(record.issued_on)) reject('issued_on must be YYYY-MM-DD.')
        else tally(result.purchase_evidence, inserted.purchase, upsertPurchase(db, companyId, record, context.now))
        break
      case 'card_transaction':
        tally(result.purchase_evidence, inserted.purchase, upsertPurchase(db, companyId, cardToPurchase(record), context.now))
        break
      case 'bank_account': {
        const outcome = upsertAccount(db, companyId, record, context)
        if (outcome.inserted) result.bank_accounts.inserted++
        else result.bank_accounts.updated++
        if (record.balance !== undefined && record.balance_date !== undefined && isPlainDate(record.balance_date)) {
          upsertBalanceSnapshot(db, outcome.id, record.balance_date, record.balance, 'scrap')
          result.bank_balances++
        }
        break
      }
      case 'bank_transaction': {
        const account = findBankAccountByDigest(db, companyId, record.bank_code, accountNumberDigest(record.account_number))
        if (account === undefined) {
          reject('Unknown bank account; send its bank_account record first.')
          break
        }
        const outcome = upsertBankTransaction(db, companyId, account.id, record, context.now)
        tally(result.bank_transactions, inserted.bank, outcome)
        const days = touchedDays.get(account.id) ?? new Set<string>()
        days.add(record.transacted_at.slice(0, 10))
        touchedDays.set(account.id, days)
        break
      }
      case 'bank_balance': {
        const account = findBankAccountByDigest(db, companyId, record.bank_code, accountNumberDigest(record.account_number))
        if (account === undefined || !isPlainDate(record.date)) reject('Unknown bank account or invalid date.')
        else {
          upsertBalanceSnapshot(db, account.id, record.date, record.closing_balance, 'scrap')
          result.bank_balances++
        }
        break
      }
      case 'giro_bills':
        break
    }
  }
  for (const [accountId, days] of touchedDays) deriveDailyBalances(db, accountId, days)
  result.classified.sales = classifyNewRows(db, companyId, 'sales', inserted.sales)
  result.classified.purchase = classifyNewRows(db, companyId, 'purchase', inserted.purchase)
  result.classified.bank = classifyNewRows(db, companyId, 'bank', inserted.bank)
  return result
}

interface UpsertOutcome {
  id: string
  inserted: boolean
}

function upsertSales(db: DatabaseSync, companyId: string, record: ScrapedSalesEvidence, now: string): UpsertOutcome {
  const existing = queryOne<{ id: string }>(db, 'SELECT id FROM sales_evidence WHERE company_id = ? AND source = ? AND external_key = ?', [
    companyId,
    record.source,
    record.external_key,
  ])
  const values = {
    issued_on: record.issued_on,
    total_amount: record.total_amount,
    supply_amount: record.supply_amount ?? null,
    vat_amount: record.vat_amount ?? null,
    dedupe_group: record.dedupe_group ?? null,
    synced_at: now,
    ...evidenceColumns(record),
    channel: record.channel ?? null,
  }
  if (existing !== undefined) {
    updateRow(db, 'sales_evidence', existing.id, values)
    linkPartnerIfEmpty(db, 'sales_evidence', companyId, existing.id, record.counterparty_business_number)
    return { id: existing.id, inserted: false }
  }
  const id = randomUUID()
  insertRow(db, 'sales_evidence', {
    id,
    company_id: companyId,
    source: record.source,
    external_key: record.external_key,
    partner_id: partnerFor(db, companyId, record.counterparty_business_number),
    ...values,
  })
  return { id, inserted: true }
}

function upsertPurchase(db: DatabaseSync, companyId: string, record: ScrapedPurchaseEvidence, now: string): UpsertOutcome {
  const existing = queryOne<{ id: string }>(db, 'SELECT id FROM purchase_evidence WHERE company_id = ? AND source = ? AND external_key = ?', [
    companyId,
    record.source,
    record.external_key,
  ])
  const values = {
    issued_on: record.issued_on,
    supply_amount: record.supply_amount,
    vat_amount: record.vat_amount,
    total_amount: record.total_amount ?? record.supply_amount + record.vat_amount,
    synced_at: now,
    ...evidenceColumns(record),
  }
  if (existing !== undefined) {
    updateRow(db, 'purchase_evidence', existing.id, values)
    linkPartnerIfEmpty(db, 'purchase_evidence', companyId, existing.id, record.counterparty_business_number)
    return { id: existing.id, inserted: false }
  }
  const id = randomUUID()
  insertRow(db, 'purchase_evidence', {
    id,
    company_id: companyId,
    source: record.source,
    external_key: record.external_key,
    account_code: null,
    deductible: record.deductible === undefined ? null : record.deductible ? 1 : 0,
    partner_id: partnerFor(db, companyId, record.counterparty_business_number),
    ...values,
  })
  return { id, inserted: true }
}

function cardToPurchase(record: ScrapedCardTransaction): ScrapedPurchaseEvidence {
  const vat = record.vat_amount ?? 0
  return {
    kind: 'purchase_evidence',
    source: 'card',
    external_key: `${record.approval_no}:${record.card_number_masked}:${record.approved_at}`,
    issued_on: record.approved_at.slice(0, 10),
    supply_amount: record.total_amount - vat,
    vat_amount: vat,
    total_amount: record.total_amount,
    counterparty_name: record.merchant_name,
    counterparty_business_number: record.merchant_business_number,
    card_number_masked: record.card_number_masked,
    card_company_code: record.card_company_code,
    approval_no: record.approval_no,
    is_canceled: record.is_canceled ?? record.total_amount < 0,
  }
}

function evidenceColumns(record: ScrapedSalesEvidence | ScrapedPurchaseEvidence): Record<string, string | number | null> {
  return {
    written_on: record.written_on ?? null,
    doc_type: record.doc_type ?? null,
    kind: record.evidence_kind ?? null,
    counterparty_business_number: record.counterparty_business_number?.replace(/-/g, '') ?? null,
    counterparty_name: record.counterparty_name ?? null,
    item_summary: record.item_summary ?? null,
    items: record.items === undefined ? null : JSON.stringify(record.items),
    card_number_masked: record.card_number_masked ?? null,
    card_company_code: record.card_company_code ?? null,
    approval_no: record.approval_no ?? null,
    is_canceled: (record.is_canceled ?? (record.kind === 'sales_evidence' ? record.total_amount < 0 : record.supply_amount < 0)) ? 1 : 0,
  }
}

function upsertAccount(db: DatabaseSync, companyId: string, record: ScrapedBankAccount, context: IngestContext): UpsertOutcome {
  const existing = findBankAccountByDigest(db, companyId, record.bank_code, accountNumberDigest(record.account_number))
  const digits = record.account_number.replace(/\D/g, '')
  const row: BankAccountRow = {
    id: existing?.id ?? randomUUID(),
    company_id: companyId,
    integration_id: record.integration_id ?? existing?.integration_id ?? null,
    bank_code: record.bank_code,
    account_number_enc: existing?.account_number_enc ?? context.cipher.encrypt(digits),
    account_number_digest: accountNumberDigest(digits),
    account_number_tail: accountNumberTail(digits),
    account_name: record.account_name ?? existing?.account_name ?? null,
    account_type: record.account_type,
    is_corporate: record.is_corporate === false ? 0 : 1,
    currency_code: record.currency_code ?? 'KRW',
    holder: record.holder ?? null,
    open_date: record.open_date ?? null,
    end_date: record.end_date ?? null,
    balance: record.balance ?? existing?.balance ?? null,
    balance_fx: record.balance_fx ?? null,
    fx_rate: record.fx_rate ?? null,
    is_dormant: record.is_dormant === true ? 1 : 0,
    is_active: record.is_active === false ? 0 : 1,
    is_visible_on_cash_report: existing?.is_visible_on_cash_report ?? 1,
    last_transaction_date: existing?.last_transaction_date ?? null,
    external_key: record.external_key ?? null,
    created_at: existing?.created_at ?? context.now,
    updated_at: context.now,
  }
  if (existing === undefined) insertBankAccountRow(db, row)
  else updateBankAccountScraped(db, row)
  return { id: row.id, inserted: existing === undefined }
}

function upsertBankTransaction(db: DatabaseSync, companyId: string, accountId: string, record: ScrapedBankTransaction, now: string): UpsertOutcome {
  const existing = queryOne<{ id: string }>(db, 'SELECT id FROM bank_transactions WHERE company_id = ? AND account_id = ? AND external_key = ?', [
    companyId,
    accountId,
    record.external_key,
  ])
  const values = {
    transacted_at: record.transacted_at.replace('T', ' ').slice(0, 16),
    direction: record.amount < 0 ? 'withdrawal' : 'deposit',
    amount: record.amount,
    balance_after: record.balance_after ?? null,
    summary: record.summary ?? null,
    currency_code: record.currency_code ?? 'KRW',
    amount_fx: record.amount_fx ?? null,
    synced_at: now,
  }
  execute(db, 'UPDATE bank_accounts SET last_transaction_date = MAX(COALESCE(last_transaction_date, ?), ?) WHERE id = ?', [
    values.transacted_at.slice(0, 10),
    values.transacted_at.slice(0, 10),
    accountId,
  ])
  if (existing !== undefined) {
    updateRow(db, 'bank_transactions', existing.id, values)
    return { id: existing.id, inserted: false }
  }
  const id = randomUUID()
  insertRow(db, 'bank_transactions', { id, company_id: companyId, account_id: accountId, external_key: record.external_key, ...values })
  return { id, inserted: true }
}

function deriveDailyBalances(db: DatabaseSync, accountId: string, days: ReadonlySet<string>): void {
  for (const day of days) {
    const last = queryAll<{ balance_after: number }>(
      db,
      `SELECT balance_after FROM bank_transactions WHERE account_id = ? AND substr(transacted_at, 1, 10) = ? AND balance_after IS NOT NULL
       ORDER BY transacted_at DESC, external_key DESC LIMIT 1`,
      [accountId, day],
    )[0]
    if (last !== undefined && isPlainDate(day)) upsertBalanceSnapshot(db, accountId, day, last.balance_after, 'derived')
  }
}

function partnerFor(db: DatabaseSync, companyId: string, businessNumber: string | undefined): string | null {
  return businessNumber === undefined ? null : findPartnerIdByBusinessNumber(db, companyId, businessNumber)
}

function linkPartnerIfEmpty(db: DatabaseSync, table: string, companyId: string, id: string, businessNumber: string | undefined): void {
  const partnerId = partnerFor(db, companyId, businessNumber)
  if (partnerId !== null) execute(db, `UPDATE ${table} SET partner_id = ? WHERE id = ? AND partner_id IS NULL`, [partnerId, id])
}

function insertRow(db: DatabaseSync, table: string, values: Record<string, string | number | null>): void {
  const columns = Object.keys(values)
  execute(db, `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(values))
}

function updateRow(db: DatabaseSync, table: string, id: string, values: Record<string, string | number | null>): void {
  const columns = Object.keys(values)
  execute(db, `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`, [...Object.values(values), id])
}

function tally(target: IngestCounts, insertedIds: string[], outcome: UpsertOutcome): void {
  if (outcome.inserted) {
    target.inserted++
    insertedIds.push(outcome.id)
  } else {
    target.updated++
  }
}

function counts(): IngestCounts {
  return { inserted: 0, updated: 0 }
}

function kindOrder(record: ScrapedRecord): number {
  return record.kind === 'bank_account' ? 0 : 1
}
