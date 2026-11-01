import { beforeEach, describe, expect, it } from 'vitest'
import { queryAll, queryOne } from '../../src/db/query'
import { ingestScrapedRecords } from '../../src/modules/bookkeeping/ingestion/ingest-scraped-records'
import type { ScrapedRecord } from '../../src/modules/bookkeeping/ingestion/ingestion.types'
import { CORP, createTestContext, NOW, type TestContext } from '../helpers/test-app'

const invoice: ScrapedRecord = {
  kind: 'sales_evidence',
  external_key: '20261103-41000000-00000001',
  source: 'tax_invoice',
  issued_on: '2026-11-03',
  total_amount: 1_100_000,
  supply_amount: 1_000_000,
  vat_amount: 100_000,
  counterparty_business_number: '1108100011',
  counterparty_name: '(주)에코프로비엠',
}

const main = { bank_code: '004', account_number: '123-456-789012' }

describe('bookkeeping ingestion', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  const ingest = (records: ScrapedRecord[]): ReturnType<typeof ingestScrapedRecords> => ingestScrapedRecords(ctx.db, CORP, records, { now: NOW, cipher: ctx.cipher })
  const salesRows = (): { id: string; total_amount: number; partner_id: string | null; account_title_id: string | null }[] =>
    queryAll(ctx.db, 'SELECT id, total_amount, partner_id, account_title_id FROM sales_evidence WHERE external_key = ?', [invoice.external_key])

  it('stores the same external key once and refreshes scraped amounts', () => {
    expect(ingest([invoice]).sales_evidence).toEqual({ inserted: 1, updated: 0 })
    const [row] = salesRows()
    expect(row).toMatchObject({ total_amount: 1_100_000, partner_id: 'pt-ecopro' })

    ctx.db.prepare("UPDATE sales_evidence SET account_title_id = 'at-sales', classified_by = 'manual' WHERE id = ?").run(row?.id ?? '')
    expect(ingest([{ ...invoice, total_amount: 2_200_000, supply_amount: 2_000_000, vat_amount: 200_000 }]).sales_evidence).toEqual({ inserted: 0, updated: 1 })
    expect(salesRows()).toEqual([{ id: row?.id, total_amount: 2_200_000, partner_id: 'pt-ecopro', account_title_id: 'at-sales' }])
  })

  it('deduplicates bank transactions and classifies new ones by rule', () => {
    const deposit: ScrapedRecord = {
      kind: 'bank_transaction',
      ...main,
      external_key: 'demo-main-1101',
      transacted_at: '2026-11-01T09:30:00+09:00',
      amount: 5_000_000,
      balance_after: 76_450_000,
      summary: '에코프로비엠 잔금',
    }
    const first = ingest([deposit, deposit])
    expect(first.bank_transactions).toEqual({ inserted: 1, updated: 1 })
    expect(first.classified.bank).toBe(1)
    expect(ingest([deposit]).bank_transactions).toEqual({ inserted: 0, updated: 1 })
    expect(queryAll(ctx.db, "SELECT account_title_id, partner_id FROM bank_transactions WHERE external_key = 'demo-main-1101'")).toEqual([
      { account_title_id: 'at-trade-sales-in-partner', partner_id: 'pt-ecopro' },
    ])
    expect(queryOne(ctx.db, "SELECT closing_balance, source FROM bank_balance_snapshots WHERE account_id = 'ba-main' AND date = '2026-11-01'")).toEqual({
      closing_balance: 76_450_000,
      source: 'derived',
    })
  })

  it('registers accounts by encrypted number and rejects transactions of unknown accounts', () => {
    const result = ingest([
      { kind: 'bank_transaction', bank_code: '020', account_number: '1002-333-444555', external_key: 'x-1', transacted_at: '2026-11-01T10:00:00+09:00', amount: 1_000 },
      { kind: 'bank_account', bank_code: '020', account_number: '1002-333-444555', account_type: '01', balance: 1_000, balance_date: '2026-11-01' },
    ])
    expect(result.bank_accounts).toEqual({ inserted: 1, updated: 0 })
    expect(result.bank_transactions).toEqual({ inserted: 1, updated: 0 })
    const account = queryOne<{ account_number_enc: string; account_number_tail: string }>(ctx.db, "SELECT account_number_enc, account_number_tail FROM bank_accounts WHERE bank_code = '020'")
    expect(account?.account_number_tail).toBe('444555')
    expect(account?.account_number_enc).not.toContain('444555')
    expect(ctx.cipher.decrypt(account?.account_number_enc ?? '')).toBe('1002333444555')

    const orphan = ingest([{ kind: 'bank_transaction', bank_code: '011', account_number: '999-99', external_key: 'x-2', transacted_at: '2026-11-01T10:00:00+09:00', amount: 1 }])
    expect(orphan.rejected).toEqual([{ index: 0, reason: expect.stringContaining('Unknown bank account') }])
  })

  it('turns card approvals into purchase evidence classified by rule', () => {
    const card: ScrapedRecord = {
      kind: 'card_transaction',
      card_number_masked: '9410-****-****-1234',
      approval_no: '30012345',
      approved_at: '2026-11-01T12:30:00+09:00',
      merchant_name: '김밥천국',
      total_amount: 33_000,
      vat_amount: 3_000,
    }
    const result = ingest([card, card])
    expect(result.purchase_evidence).toEqual({ inserted: 1, updated: 1 })
    expect(result.classified.purchase).toBe(1)
    expect(queryAll(ctx.db, "SELECT supply_amount, vat_amount, account_title_id, source FROM purchase_evidence WHERE approval_no = '30012345'")).toEqual([
      { supply_amount: 30_000, vat_amount: 3_000, account_title_id: 'at-sga-welfare', source: 'card' },
    ])
  })

  it('rejects malformed dates without aborting the batch', () => {
    const result = ingest([{ ...invoice, issued_on: '2026/11/03' }, { ...invoice, external_key: 'other' }])
    expect(result.rejected).toEqual([{ index: 0, reason: 'issued_on must be YYYY-MM-DD.' }])
    expect(result.sales_evidence.inserted).toBe(1)
  })
})
