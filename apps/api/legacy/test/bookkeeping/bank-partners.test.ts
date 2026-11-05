import { beforeEach, describe, expect, it } from 'vitest'
import { queryAll, queryOne } from '../../src/db/query'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const company = `/api/company/${CORP}`
const october = 'start_date=2026-10-01&end_date=2026-10-31'

interface Partner {
  id: string
  unsettled_sales_amount: number
  unsettled_purchase_amount: number
}

describe('bookkeeping bank and partners', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const json = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const response = await ctx.call(admin, method, path, body === undefined ? {} : { json: body })
    return { status: response.status, body: (await response.json()) as T }
  }
  const transactionId = (externalKey: string): string =>
    queryOne<{ id: string }>(ctx.db, 'SELECT id FROM bank_transactions WHERE external_key = ?', [externalKey])?.id ?? ''
  const partner = async (id: string): Promise<Partner> => (await json<Partner>('GET', `${company}/partners/${id}`)).body

  it('masks account numbers and stores them encrypted', async () => {
    const { body } = await json<{ summary: Record<string, unknown>; accounts: Record<string, unknown>[] }>('GET', `${company}/bank/accounts`)
    expect(body.summary).toMatchObject({ account_count: 3, total_assets: 73_450_000, total_liabilities: 100_000_000 })
    expect(body.accounts[0]).toMatchObject({ id: 'ba-main', account_number: '********789012', balance: 71_450_000 })
    const stored = queryAll<{ account_number_enc: string }>(ctx.db, 'SELECT account_number_enc FROM bank_accounts')
    for (const row of stored) expect(row.account_number_enc).not.toMatch(/\d{6}/)
    expect(ctx.cipher.decrypt(stored[0]?.account_number_enc ?? '')).toMatch(/\d/)
  })

  it('lists transactions with totals and settlement statuses', async () => {
    const { body } = await json<{ count: number; totals: Record<string, number>; counts: Record<string, number>; results: Record<string, unknown>[] }>(
      'GET',
      `${company}/bank/transactions?${october}`,
    )
    expect(body.count).toBe(8)
    expect(body.totals).toEqual({ deposit: 44_930_000, withdrawal: -21_500_000, net: 23_430_000 })
    expect(body.counts).toEqual({ all: 8, classified: 6, unclassified: 2 })
    const byId = new Map(body.results.map((row) => [row['id'], row]))
    expect(byId.get(transactionId('demo-main-1006'))).toMatchObject({ settlement_status: 'matched', partner_id: 'pt-ecopro' })
    expect(byId.get(transactionId('demo-main-1031a'))).toMatchObject({ settlement_status: 'unmatched' })
    expect(byId.get(transactionId('demo-main-1015'))).toMatchObject({ settlement_status: 'not_applicable' })

    const deposits = await json<{ count: number }>('GET', `${company}/bank/transactions?${october}&direction=deposit&account_id=ba-main`)
    expect(deposits.body.count).toBe(4)
  })

  it('derives daily balances while scraped snapshots win', async () => {
    const { body } = await json<{ results: { date: string; closing_balance: number; source: string }[] }>(
      'GET',
      `${company}/bank/accounts/ba-main/balances?start_date=2026-10-27&end_date=2026-10-31`,
    )
    expect(body.results.map((row) => [row.date, row.closing_balance, row.source])).toEqual([
      ['2026-10-28', 69_730_000, 'derived'],
      ['2026-10-31', 71_450_000, 'scrap'],
    ])
  })

  it('computes unsettled amounts from classified evidence minus settlement links', async () => {
    expect(await partner('pt-office')).toMatchObject({ unsettled_sales_amount: 0, unsettled_purchase_amount: 11_000_000 })
    expect(await partner('pt-ecopro')).toMatchObject({ unsettled_sales_amount: 0, unsettled_purchase_amount: 0 })

    const office = transactionId('demo-main-1010')
    const partial = await json('POST', `${company}/bank/transactions/${office}/settlements`, [{ evidence_side: 'purchase', evidence_id: 'p-1', amount: 4_000_000 }])
    expect(partial.status).toBe(200)
    expect(partial.body).toMatchObject({ settlement_status: 'unmatched' })
    expect((await partner('pt-office')).unsettled_purchase_amount).toBe(7_000_000)

    const full = await json('POST', `${company}/bank/transactions/${office}/settlements`, [{ evidence_side: 'purchase', evidence_id: 'p-1', amount: 11_000_000 }])
    expect(full.body).toMatchObject({ settlement_status: 'matched' })
    expect((await partner('pt-office')).unsettled_purchase_amount).toBe(0)

    const unlinked = await json('DELETE', `${company}/bank/transactions/${office}/settlements?evidence_id=p-1`)
    expect(unlinked.body).toMatchObject({ settlement_status: 'unmatched' })
    expect((await partner('pt-office')).unsettled_purchase_amount).toBe(11_000_000)
  })

  it('reclassifies a transaction manually and requires a partner for trade accounts', async () => {
    const id = transactionId('demo-main-1028')
    const trade = await json('PATCH', `${company}/bank/transactions/${id}`, { account_title_id: 'at-trade-sales-in-card' })
    expect(trade.status).toBe(200)
    expect(trade.body).toMatchObject({ account_title_id: 'at-trade-sales-in-card', classified_by: 'manual', settlement_status: 'partner_required' })
    const withdrawal = await json('PATCH', `${company}/bank/transactions/${transactionId('demo-main-1031b')}`, { account_title_id: 'at-sales' })
    expect(withdrawal.status).toBe(422)
  })

  it('registers a partner and links its evidence by business number', async () => {
    ctx.db.prepare("UPDATE sales_evidence SET counterparty_business_number = '4408100044' WHERE id = 's-6'").run()
    const created = await json<{ id: string; business_status: string }>('POST', `${company}/partners`, {
      partner_type: 'business',
      business_entity_type: 'corporation',
      sales: true,
      purchased: false,
      name: '온라인몰 고객',
      representative_name: '정대표',
      business_number: '4408100044',
      bank_accounts: [{ bank_code: '004', account_number: '987654321012', is_primary: true }],
    })
    expect(created.status).toBe(201)
    expect(queryOne<{ partner_id: string }>(ctx.db, "SELECT partner_id FROM sales_evidence WHERE id = 's-6'")?.partner_id).toBe(created.body.id)
    const fetched = await json<{ bank_accounts: { account_number: string }[] }>('GET', `${company}/partners/${created.body.id}`)
    expect(fetched.body.bank_accounts[0]?.account_number).not.toContain('987654')

    const duplicate = await json('POST', `${company}/partners`, { partner_type: 'business', sales: true, purchased: false, name: '중복', representative_name: '중복', business_number: '4408100044' })
    expect(duplicate.status).toBe(422)
  })

  it('looks up the business status through the adapter', async () => {
    const closed = await json<{ business_status: string }>('GET', `${company}/partner/scrap/business-status?business_number=1234567899`)
    expect(closed.status).toBe(200)
    expect(closed.body.business_status).toBe('closed')
    const open = await json<{ business_status: string }>('GET', `${company}/partner/scrap/business-status?business_number=1234567890`)
    expect(open.body.business_status).toBe('registered')
  })
})
