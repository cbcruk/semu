import { beforeEach, describe, expect, it } from 'vitest'
import { SEED } from '../../src/db/seed'
import { DEFAULT_BOOKKEEPING_POLICY, saveBookkeepingPolicy } from '../../src/modules/bookkeeping/settings/bookkeeping-settings'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

type Json = Record<string, any>

describe('settlement tax reports', () => {
  let ctx: TestContext
  let admin: string
  let agent: string
  const base = `/api/company/${CORP}`
  const get = async (token: string, path: string): Promise<{ status: number; body: Json }> => {
    const response = await ctx.call(token, 'GET', path)
    return { status: response.status, body: (await response.json()) as Json }
  }

  beforeEach(async () => {
    ctx = await createTestContext({ schedule: false })
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
  })

  it('renders the profit and loss statement with Korean sub_list keys and derived sections', async () => {
    const { status, body } = await get(admin, `${base}/report/profit-loss/2026/`)
    expect(status).toBe(200)
    const { content } = body
    expect(content.has_data).toBe(true)
    expect(Object.keys(content.data)).toEqual(['2026'])
    expect(content.month_range).toHaveLength(21)
    expect(content.month_range[0]).toBe('202501')
    expect(content.month_range.at(-1)).toBe('202609')
    expect(content.updated).toEqual({ '2026': '2026-10-15 10:00:00' })
    const january = content.data['2026']['1']
    expect(Object.keys(january)).toEqual(['매출액', '매출원가', '매출총이익', '판매비와관리비', '영업이익', '영업외수익', '영업외비용', '법인세등', '당기순이익'])
    expect(january['매출액']).toEqual({
      value: 6_600_000,
      sub_list: { 상품매출: { value: 5_600_000, sub_list: {} }, 용역매출: { value: 1_000_000, sub_list: {} } },
    })
    expect(january['매출원가'].value).toBe(2_110_000)
    expect(january['매출총이익'].value).toBe(4_490_000)
    expect(january['판매비와관리비'].value).toBe(2_305_000)
    expect(january['판매비와관리비'].sub_list['지급수수료'].sub_list['카드수수료']).toEqual({ value: 30_000, sub_list: {} })
    expect(january['영업이익'].value).toBe(2_185_000)
    expect(january['당기순이익'].value).toBe(2_165_000)
    expect(content.data['2026']['10']).toBeUndefined()
  })

  it('adds the previous year in the month-range variant', async () => {
    const { body } = await get(admin, `${base}/report/profit-loss/2026/month-range`)
    expect(Object.keys(body.content.data)).toEqual(['2025', '2026'])
    expect(body.content.updated['2025']).toBe('2026-01-10 14:36:45')
    expect(body.content.data['2025']['12']['법인세등'].value).toBe(100_000)
  })

  it('reports has_data false for a company without snapshots', async () => {
    const individual = SEED.companies.individual
    const token = await ctx.token(USERS.individualAdmin, individual)
    const { status, body } = await get(token, `/api/company/${individual}/report/profit-loss/2026`)
    expect(status).toBe(200)
    expect(body.content).toEqual({ has_data: false, month_range: [], data: {}, updated: {} })
  })

  it('computes cost ratios and the welfare usage rate', async () => {
    const { body } = await get(admin, `${base}/report/profit-loss/2026/cost-details`)
    expect(body.months[0]).toMatchObject({ month: 1, revenue: 6_600_000, cost_total: 4_445_000, cogs_ratio: '31.97', sga_ratio: '34.92' })
    expect(body.welfare_usage).toEqual({ labor_cost: 13_500_000, welfare: 1_800_000, rate: '13.33', baseline: '20.00' })
    expect(body.sga_top[0].name).toBe('직원급여')
  })

  it('serves cash flow amounts as strings', async () => {
    expect((await get(admin, `${base}/report/cash-flow/summary/`)).body).toEqual({
      has_data: true,
      closing_date: '2026-09-30',
      funds_held: 29_180_000,
      closing_list: [2026],
    })
    const { body } = await get(admin, `${base}/report/cash-flow/2026`)
    expect(body).toHaveLength(9)
    expect(body[0]).toEqual({ month: 1, inflow: '7100000', effluent: '6080000', unique_inflow: '1020000', funds_held: '21020000' })
  })

  it('keeps receivable and payable invariants', async () => {
    expect((await get(admin, `${base}/accounting/settlement/receivable-payable/summary/`)).body).toEqual({
      has_data: true,
      receivable_balance: 8_500_000,
      payable_balance: 4_300_000,
      latest_settlement_date: '2026-09-30',
      closing_list: [2026],
    })
    const yearly = (await get(admin, `${base}/accounting/settlement/receivable-payable/2026/`)).body
    for (const item of yearly.monthly_receivable) {
      expect(Number(item.balance)).toBe(Number(item.previous_month_roll_over_balance) + Number(item.increase_amount) - Number(item.decrease_amount))
    }
    expect(yearly.monthly_receivable[1].previous_month_roll_over_balance).toBe(yearly.monthly_receivable[0].balance)
    const partners = (await get(admin, `${base}/accounting/settlement/receivable-by-partner/2026/?page=1`)).body
    expect(partners).toMatchObject({ count: 2, next: null, previous: null })
    expect(partners.results[0]).toEqual({
      partner_id: 101,
      partner_name: '(주)가나상사',
      summary: 'IT 서비스 및 컨설팅 외 1건',
      count: 18,
      balance: '7500000',
      increase_amount: '18000000',
      decrease_amount: '13500000',
      previous_month_roll_over_balance: '3000000',
    })
    const total = partners.results.reduce((sum: number, row: Json) => sum + Number(row.balance), 0)
    expect(String(total)).toBe(yearly.monthly_receivable.at(-1).balance)
    const ledger = (await get(admin, `${base}/accounting/settlement/receivable-by-partner/2026/101/`)).body
    expect(ledger).toMatchObject({ name: '(주)가나상사', year: 2026, balance: '7500000', rollover_balance: '3000000' })
    expect(ledger.item).toHaveLength(18)
    expect(ledger.item.at(-1).balance).toBe(ledger.balance)
    expect((await get(admin, `${base}/accounting/settlement/payable-by-partner/2026/999`)).status).toBe(404)
  })

  it('computes balance sheet ratios and the fixed table order', async () => {
    expect((await get(admin, `${base}/report/balance-sheet/summary`)).body).toEqual({
      has_data: true,
      closing_date: '2026-09-30',
      assets: 71_000_000,
      liabilities: 28_000_000,
      equity: 43_000_000,
      closing_list: [2026],
    })
    const chart = (await get(admin, `${base}/report/balance-sheet/chart/2026`)).body as Json[]
    const january = (name: string): string | null => chart.find((series) => series.name === name)?.items[0].ratio
    expect(january('자기자본비율')).toBe('55.56')
    expect(january('부채비율')).toBe('80.00')
    expect(january('유동비율')).toBe('412.50')
    expect(january('총자본순이익률')).toBe('3.44')
    expect(january('총자산회전율')).toBe('0.10')
    expect(chart.find((series) => series.name === '부채비율')?.ratio).toBe(String(((28 / 43) * 100).toFixed(2)))
    const table = (await get(admin, `${base}/report/balance-sheet/table/2026`)).body
    expect(table).toHaveLength(9)
    expect(table[0].target_date).toBe('2026-01-01')
    expect(table[0].items.map((item: Json) => item.subject)).toEqual(['자산', '부채', '자본', '부채와자본'])
    expect(table[0].items[2].items.map((item: Json) => item.subject)).toEqual(['Ⅰ.자본금', 'Ⅱ.자본잉여금', 'Ⅲ.자본조정', 'Ⅳ.기타포괄손익누계액', 'Ⅴ.이익잉여금'])
    expect(table[0].items[3]).toEqual({ subject: '부채와자본', amount: 63_000_000, items: [] })
  })

  it('gates premium reports per company while agency staff pass', async () => {
    saveBookkeepingPolicy(ctx.db, CORP, { ...DEFAULT_BOOKKEEPING_POLICY, premiumSettlement: false }, ctx.clock.now())
    const denied = await get(admin, `${base}/report/cash-flow/summary`)
    expect(denied.status).toBe(403)
    expect(denied.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', promotion_url: '/settings/plan/detail' })
    expect((await get(admin, `${base}/report/balance-sheet/summary`)).status).toBe(403)
    expect((await get(admin, `${base}/report/profit-loss/2026`)).status).toBe(200)
    expect((await get(agent, `${base}/report/cash-flow/summary`)).status).toBe(200)
    const free = SEED.companies.free
    const freeToken = await ctx.token(USERS.freeAdmin, free)
    expect((await get(freeToken, `/api/company/${free}/report/profit-loss/2026`)).body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
    const plain = await ctx.token(USERS.plainMember, CORP)
    expect((await get(plain, `${base}/report/profit-loss/2026`)).body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('replaces a scope on upload and derives the totals', async () => {
    const path = `/api/desk/companies/${CORP}/settlements/2026/pl`
    const lines = [
      { month: 1, section: '매출액', path: '상품매출', amount: 1_000_000 },
      { month: 1, section: '매출원가', path: '', amount: 400_000 },
      { month: 1, section: '판매비와관리비', path: '직원급여', amount: 300_000 },
      { month: 1, section: '법인세등', path: '', amount: 50_000 },
    ]
    const first = await ctx.call(agent, 'PUT', path, { json: { closed_through: '2026-01-31', lines } })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ fiscal_year: 2026, scope: 'pl', closed_through: '2026-01-31', updated_by: USERS.agent, updated_at: ctx.clock.now() })
    const january = (await get(admin, `${base}/report/profit-loss/2026`)).body.content.data['2026']['1']
    expect(january['매출총이익'].value).toBe(600_000)
    expect(january['영업이익'].value).toBe(300_000)
    expect(january['당기순이익'].value).toBe(250_000)
    expect(Object.keys((await get(admin, `${base}/report/profit-loss/2026`)).body.content.data['2026'])).toEqual(['1'])

    await ctx.call(agent, 'PUT', path, { json: { closed_through: '2026-01-31', lines: lines.slice(0, 1) } })
    const replaced = (await get(admin, `${base}/report/profit-loss/2026`)).body.content.data['2026']['1']
    expect(replaced['매출원가'].value).toBe(0)
    expect(replaced['당기순이익'].value).toBe(1_000_000)
    expect((await get(agent, path)).body).toMatchObject({ closed_through: '2026-01-31' })
  })

  it('rejects derived sections, broken balances and dates outside the year', async () => {
    const put = async (scope: string, json: unknown): Promise<number> =>
      (await ctx.call(agent, 'PUT', `/api/desk/companies/${CORP}/settlements/2026/${scope}`, { json })).status
    expect(await put('pl', { closed_through: '2026-01-31', lines: [{ month: 1, section: '영업이익', path: '', amount: 1 }] })).toBe(422)
    expect(await put('pl', { closed_through: '2025-12-31', lines: [] })).toBe(422)
    const balance = { kind: 'receivable', month: 1, erp_partner_code: '1', partner_name: 'A', summary: null, entry_count: 1, rollover_balance: 0, increase_amount: 10, decrease_amount: 0 }
    expect(await put('ar_ap', { closed_through: '2026-01-31', balances: [{ ...balance, balance: 5 }] })).toBe(422)
    expect(await put('ar_ap', { closed_through: '2026-01-31', balances: [{ ...balance, balance: 10 }] })).toBe(200)
    expect(await put('bs', { closed_through: '2026-01-31', rows: [{ target_month: '2026-01-01', subject: '재고자산', parent_subject: 'Ⅰ.유동자산', sort_order: 1, amount: 1 }] })).toBe(422)
  })

  it('limits uploads to assigned agency staff', async () => {
    const path = `/api/desk/companies/${CORP}/settlements/2026/cash`
    const json = { closed_through: '2026-01-31', ledger: [] }
    expect((await ctx.call(admin, 'PUT', path, { json })).status).toBe(403)
    expect((await ctx.call(await ctx.token(USERS.otherAgent), 'PUT', path, { json })).status).toBe(404)
    expect((await ctx.call(await ctx.token(USERS.manager), 'PUT', path, { json })).status).toBe(200)
  })

  it('exports reports as CSV and leaves labor cost to payroll', async () => {
    const response = await ctx.call(admin, 'GET', `${base}/report/profit-loss/2026/export`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('매출액,상품매출,')
    expect(text).toContain('판매비와관리비,지급수수료 > 카드수수료,270000')
    for (const path of ['/report/cost-details/2026/export', '/report/receivable-payable/2026/export', '/report/cash-flow/2026/export', '/report/balance-sheet/2026/export']) {
      expect((await ctx.call(admin, 'GET', `${base}${path}`)).status).toBe(200)
    }
    expect((await ctx.call(admin, 'GET', `${base}/report/labor-cost/2026/export`)).headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
  })
})
