import { beforeEach, describe, expect, it } from 'vitest'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const base = `/api/company/${CORP}/transaction-sales`

function statementBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    write_date: '2026-10-30',
    buyer_business_number: '2208199999',
    buyer_company_name: '주식회사 고객',
    buyer_representative_name: '최고객',
    items: [
      { month: '10', day: '30', name: '개발 용역', supply_amount: 1_000_000, tax_amount: 100_000 },
      { month: '10', day: '30', name: '유지보수', supply_amount: 500_000, tax_amount: 50_000 },
    ],
    charge_total_amount: 1_500_000,
    tax_total_amount: 150_000,
    grand_total_amount: 1_650_000,
    ...overrides,
  }
}

describe('transaction sales', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const json = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await ctx.call(admin, method, path, body === undefined ? {} : { json: body })
    return { status: response.status, body: response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>) }
  }

  it('creates a statement with the supplier taken from the company', async () => {
    const { status, body } = await json('POST', base, statementBody())
    expect(status).toBe(201)
    expect(body).toMatchObject({
      supplier_business_number: '1108100001',
      supplier_company_name: '주식회사 데모',
      buyer_company_name: '주식회사 고객',
      class_code: '01',
      purpose: '02',
      item_summary: '개발 용역 외 1건',
      item_count: 2,
      invoice_count: 0,
      latest_issue_invoice: null,
      invoices: [],
    })
  })

  it('rejects totals that do not add up and unsupported kinds', async () => {
    expect((await json('POST', base, statementBody({ grand_total_amount: 1 }))).status).toBe(422)
    expect((await json('POST', base, statementBody({ charge_total_amount: 1_400_000, grand_total_amount: 1_550_000 }))).status).toBe(422)
    expect((await json('POST', base, statementBody({ kind_code: '03' }))).status).toBe(422)
  })

  it('issues, locks and syncs an invoice through the fake Hometax adapter', async () => {
    const created = (await json('POST', base, statementBody())).body
    const id = String(created['id'])

    const published = await json('POST', `${base}/${id}/invoices/publish`)
    expect(published.status).toBe(201)
    expect(published.body).toMatchObject({ status: 'issued', is_detail_synced: false, issue_type: 'normal', grand_total_amount: 1_650_000 })
    const issueNo = String(published.body['issue_no'])
    expect(issueNo).toMatch(/^20261030-41000000-\d{8}$/)

    expect((await json('PATCH', `${base}/${id}`, { description: 'x' })).status).toBe(409)
    expect((await json('DELETE', `${base}/${id}`)).status).toBe(409)
    expect((await json('POST', `${base}/${id}/invoices/publish`)).status).toBe(409)

    ctx.db
      .prepare(
        `INSERT INTO sales_evidence (id, company_id, source, issued_on, total_amount, supply_amount, vat_amount, synced_at, external_key)
         VALUES ('s-issued', ?, 'tax_invoice', '2027-01-05', 1650000, 1500000, 150000, 't', ?)`,
      )
      .run(CORP, issueNo)
    const synced = await json('POST', `${base}/${id}/invoices/${String(published.body['id'])}/sync`)
    expect(synced.body).toMatchObject({ is_detail_synced: true, issue_no: issueNo })
    expect(ctx.db.prepare("SELECT sales_transaction_id AS t FROM sales_evidence WHERE id = 's-issued'").get()).toEqual({ t: id })

    const detail = (await json('GET', `${base}/${id}`)).body
    expect(detail).toMatchObject({ invoice_count: 1, latest_issue_invoice_type: 'normal', latest_issue_date: '2026-11-01' })
    const invoices = (await json('GET', `${base}/${id}/invoices`)).body
    expect(invoices['count']).toBe(1)
  })

  it('records a rejected issue and keeps the statement editable', async () => {
    const id = String((await json('POST', base, statementBody({ buyer_business_number: '0000000000' }))).body['id'])
    const failed = await json('POST', `${base}/${id}/invoices/publish`)
    expect(failed.status).toBe(422)
    expect(ctx.db.prepare('SELECT status, error_code FROM issued_invoices WHERE transaction_id = ?').get(id)).toEqual({
      status: 'failed',
      error_code: 'BUYER_NOT_FOUND',
    })
    const patched = await json('PATCH', `${base}/${id}`, { buyer_business_number: '2208199999' })
    expect(patched.status).toBe(200)
    expect(patched.body['invoice_count']).toBe(0)
    expect((await json('POST', `${base}/${id}/invoices/publish`)).status).toBe(201)
  })

  it('cannot sync an invoice that was not issued', async () => {
    const id = String((await json('POST', base, statementBody({ buyer_business_number: '0000000000' }))).body['id'])
    await json('POST', `${base}/${id}/invoices/publish`)
    const invoiceId = (ctx.db.prepare('SELECT id FROM issued_invoices WHERE transaction_id = ?').get(id) as { id: string }).id
    expect((await json('POST', `${base}/${id}/invoices/${invoiceId}/sync`)).status).toBe(409)
  })

  it('summarises, filters and deletes drafts', async () => {
    const summary = (await json('GET', `${base}/summary?start_date=2026-10-01&end_date=2026-10-31`)).body
    expect(summary).toEqual({
      total_transaction_count: 2,
      total_transaction_amount: 7_700_000,
      total_invoice_count: 1,
      total_invoice_amount: 5_500_000,
      issue_required_amount: 2_200_000,
    })
    expect((await json('GET', `${base}/summary/issued-status`)).body).toEqual({ all: 2, issue_required: 1, issued: 1 })

    const issued = (await json('GET', `${base}?is_issued_invoice=true`)).body as { count: number; results: { id: string }[] }
    expect(issued.results.map((row) => row.id)).toEqual(['st-issued'])
    const searched = (await json('GET', `${base}?search=${encodeURIComponent('에코')}`)).body as { results: { id: string }[] }
    expect(searched.results.map((row) => row.id)).toEqual(['st-draft'])

    expect((await json('DELETE', `${base}/st-draft`)).status).toBe(204)
    expect((await json('GET', `${base}/st-draft`)).status).toBe(404)
  })

  it('requires the statement menu permission', async () => {
    const response = await ctx.call(await ctx.token(USERS.plainMember, CORP), 'GET', base)
    expect(response.status).toBe(403)
  })
})
