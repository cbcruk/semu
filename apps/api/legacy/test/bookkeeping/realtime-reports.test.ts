import { beforeEach, describe, expect, it } from 'vitest'
import { queryOne } from '../../src/db/query'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const company = `/api/company/${CORP}`

interface Figures {
  month: number
  revenue: number
  cogs: number
  gross_profit: number
  sga: number
  operating_profit: number
  non_op_income: number
  non_op_expense: number
  net_income: number
  breakdown: Record<string, Record<string, number>>
}

interface ProfitLoss {
  basis: string
  months: Figures[]
  total: Figures
  unclassified_count: { sales: number; purchase: number; bank: number }
}

describe('bookkeeping realtime reports', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const get = async <T>(path: string): Promise<T> => {
    const response = await ctx.call(admin, 'GET', path)
    expect(response.status).toBe(200)
    return (await response.json()) as T
  }

  it('computes October profit and loss on the supply basis', async () => {
    const report = await get<ProfitLoss>(`${company}/reports/profit-loss/status?year=2026`)
    expect(report.basis).toBe('supply')
    const october = report.months[9]
    expect(october).toMatchObject({
      month: 10,
      revenue: 44_000_000,
      cogs: 10_000_000,
      gross_profit: 34_000_000,
      sga: 11_000_000,
      operating_profit: 23_000_000,
      non_op_income: 30_000,
      non_op_expense: 0,
      net_income: 23_030_000,
    })
    expect(Object.values(october?.breakdown['sga'] ?? {}).sort((a, b) => a - b)).toEqual([800_000, 2_200_000, 8_000_000])
    expect(report.months[8]?.net_income).toBe(0)
    expect(report.total.net_income).toBe(23_030_000)
    expect(report.unclassified_count).toEqual({ sales: 2, purchase: 0, bank: 2 })
  })

  it('accumulates months and follows reclassification', async () => {
    const cumulative = await get<ProfitLoss>(`${company}/reports/profit-loss/status?year=2026&cumulative=true`)
    expect(cumulative.months[11]?.net_income).toBe(23_030_000)

    const id = queryOne<{ id: string }>(ctx.db, "SELECT id FROM bank_transactions WHERE external_key = 'demo-main-1031b'")?.id ?? ''
    const patched = await ctx.call(admin, 'PATCH', `${company}/bank/transactions/${id}`, { json: { account_title_id: 'at-sga-communication' } })
    expect(patched.status).toBe(200)
    const report = await get<ProfitLoss>(`${company}/reports/profit-loss/status?year=2026`)
    expect(report.months[9]).toMatchObject({ sga: 11_300_000, operating_profit: 22_700_000, net_income: 22_730_000 })
    expect(report.unclassified_count.bank).toBe(1)
  })

  it('reports one day of cash per account with the unexplained difference', async () => {
    const daily = await get<Record<string, unknown> & { groups: Record<string, unknown>[]; transactions: unknown[] }>(
      `${company}/reports/cash/daily?date=2026-10-31`,
    )
    expect(daily).toMatchObject({ opening: 71_730_000, deposit: 2_000_000, withdrawal: -300_000, other_change: 20_000, closing: 73_450_000, change: 1_720_000 })
    expect(daily.groups).toEqual([
      expect.objectContaining({ key: 'ba-main', opening: 69_730_000, closing: 71_450_000, other_change: 20_000 }),
      expect.objectContaining({ key: 'ba-sub', opening: 2_000_000, closing: 2_000_000, other_change: 0 }),
    ])
    expect(daily.transactions).toHaveLength(2)
  })

  it('carries balances across days without transactions', async () => {
    const quiet = await get<Record<string, number>>(`${company}/reports/cash/daily?date=2026-10-30`)
    expect(quiet).toMatchObject({ opening: 71_730_000, deposit: 0, withdrawal: 0, other_change: 0, closing: 71_730_000 })
    const payday = await get<Record<string, number>>(`${company}/reports/cash/daily?date=2026-10-25`)
    expect(payday).toMatchObject({ opening: 69_830_000, withdrawal: -8_000_000, closing: 61_830_000 })
  })

  it('hides realtime reports from members without the menu', async () => {
    const member = await ctx.token(USERS.plainMember, CORP)
    const response = await ctx.call(member, 'GET', `${company}/reports/profit-loss/status?year=2026`)
    expect(response.status).toBe(403)
  })
})
