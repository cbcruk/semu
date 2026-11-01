import { beforeEach, describe, expect, it } from 'vitest'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const company = `/api/company/${CORP}`
const october = 'start_date=2026-10-01&end_date=2026-10-31'

interface Page {
  count: number
  results: Record<string, unknown>[]
  counts: { all: number; classified: number; unclassified: number }
}

describe('bookkeeping evidence', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const list = async (path: string): Promise<Page> => {
    const response = await ctx.call(admin, 'GET', path)
    expect(response.status).toBe(200)
    return (await response.json()) as Page
  }
  const ids = (page: Page): string[] => page.results.map((row) => String(row['id'])).sort()

  it('lists the seeded month with classification counts', async () => {
    const sales = await list(`${company}/evidence/sales?${october}`)
    expect(sales.count).toBe(6)
    expect(sales.counts).toEqual({ all: 6, classified: 4, unclassified: 2 })
    const first = sales.results.find((row) => row['id'] === 's-1')
    expect(first).toMatchObject({
      partner_id: 'pt-ecopro',
      partner_name: '(주)에코프로비엠',
      item_summary: '2차전지 소재 외 2건',
      total_amount: 33_000_000,
      supply_amount: 30_000_000,
      account_title_id: 'at-sales',
      classified_by: 'manual',
    })
    const purchases = await list(`${company}/evidence/purchase?${october}`)
    expect(purchases.counts).toEqual({ all: 3, classified: 3, unclassified: 0 })
  })

  it('filters by source alias, classification status, account and search text', async () => {
    expect(ids(await list(`${company}/evidence/sales?${october}&source=card`))).toEqual(['s-2', 's-3'])
    expect(ids(await list(`${company}/evidence/sales?${october}&source=online`))).toEqual(['s-6'])
    const unclassified = await list(`${company}/evidence/sales?${october}&classification_status=unclassified`)
    expect(ids(unclassified)).toEqual(['s-5', 's-6'])
    expect(unclassified.counts).toEqual({ all: 6, classified: 4, unclassified: 2 })
    expect(ids(await list(`${company}/evidence/purchase?${october}&account_title_id=at-sga-welfare`))).toEqual(['p-2', 'p-3'])
    expect(ids(await list(`${company}/evidence/sales?${october}&search=${encodeURIComponent('에코프로')}`))).toEqual(['s-1'])
    expect((await list(`${company}/evidence/sales?start_date=2026-09-01&end_date=2026-09-30`)).count).toBe(0)
  })

  it('classifies one record manually and keeps deductibility unless sent', async () => {
    const patched = await ctx.call(admin, 'PATCH', `${company}/evidence/purchase/p-3`, { json: { account_title_id: 'at-sga-supplies', memo: '사무용품' } })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({ account_title_id: 'at-sga-supplies', classified_by: 'manual', classified_rule_id: null, memo: '사무용품', deductible: null })

    const deductible = await ctx.call(admin, 'PATCH', `${company}/evidence/purchase/p-3`, { json: { deductible: true } })
    expect(await deductible.json()).toMatchObject({ account_title_id: 'at-sga-supplies', deductible: true })

    const salesDeductible = await ctx.call(admin, 'PATCH', `${company}/evidence/sales/s-6`, { json: { deductible: true } })
    expect(salesDeductible.status).toBe(422)
  })

  it('rejects group accounts and unknown records', async () => {
    const group = await ctx.call(admin, 'PATCH', `${company}/evidence/sales/s-6`, { json: { account_title_id: 'at-g-sales' } })
    expect(group.status).toBe(422)
    const missing = await ctx.call(admin, 'GET', `${company}/evidence/sales/s-404`)
    expect(missing.status).toBe(404)
  })

  it('bulk-classifies records and exports CSV', async () => {
    const bulk = await ctx.call(admin, 'POST', `${company}/evidence/sales/bulk-classify`, { json: { ids: ['s-5', 's-6'], account_title_id: 'at-sales' } })
    expect(bulk.status).toBe(200)
    expect((await list(`${company}/evidence/sales?${october}`)).counts).toEqual({ all: 6, classified: 6, unclassified: 0 })

    const csv = await ctx.call(admin, 'GET', `${company}/evidence/sales/export?${october}`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await csv.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes).trim().split('\r\n')).toHaveLength(7)
  })
})
