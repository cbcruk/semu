import { afterAll, describe, expect, it } from 'vitest'
import { testActor } from '../../identity-access/testing.ts'
import { testApp } from '../common/test-app.ts'

type Json = {
  months: Array<{ month: string; breakdown: unknown[] }>
  figures: unknown
  byAccountTitle: unknown
  unclassifiedCount: unknown
}

const app = testApp({ noPlan: testActor({ plans: new Set() }) })
afterAll(() => app.dispose())

describe('GET /v1/reports/realtime-pl', () => {
  it('reproduces the legacy demo profit and loss for October 2026', async () => {
    const response = await app.send('GET', '/v1/reports/realtime-pl?year=2026')

    expect(response.status).toBe(200)
    const body = (await response.json()) as Json
    const october = body.months.find((row) => row.month === '2026-10')!
    expect(october).toMatchObject({
      revenueAmount: 44_000_000,
      costOfSalesAmount: 10_000_000,
      grossProfitAmount: 34_000_000,
      sgaAmount: 11_000_000,
      operatingProfitAmount: 23_000_000,
      nonOperatingIncomeAmount: 30_000,
      netIncomeAmount: 23_030_000,
    })
    expect(october.breakdown).toEqual(
      expect.arrayContaining([
        { line: 'SGA', reportName: '복리후생비', amount: 800_000 },
        { line: 'SGA', reportName: '지급임차료', amount: 2_200_000 },
        { line: 'SGA', reportName: '직원급여', amount: 8_000_000 },
      ]),
    )
    expect(body).toMatchObject({ basis: 'SUPPLY', includeBank: true, cumulative: false })
    expect(body.unclassifiedCount).toEqual({ sales: 2, purchase: 0, bank: 2 })
  })

  it('rejects a year outside the supported range', async () => {
    const response = await app.send('GET', '/v1/reports/realtime-pl?year=1990')

    expect(response.status).toBe(400)
  })
})

describe('GET /v1/reports/cash-status', () => {
  it('reproduces the legacy demo cash status for 2026-10-31', async () => {
    const response = await app.send('GET', '/v1/reports/cash-status?date=2026-10-31')

    expect(response.status).toBe(200)
    const body = (await response.json()) as Json
    expect(body.figures).toEqual({
      openingAmount: 71_730_000,
      depositAmount: 2_000_000,
      withdrawalAmount: -300_000,
      otherChangeAmount: 20_000,
      closingAmount: 73_450_000,
    })
    expect(body.byAccountTitle).toEqual([
      { direction: 'DEPOSIT', key: expect.any(String), name: '거래처대금 입금', amount: 2_000_000, count: 1 },
      { direction: 'WITHDRAWAL', key: 'UNCLASSIFIED', name: '미분류 출금', amount: -300_000, count: 1 },
    ])
  })
})

describe('GET /v1/reports/home-summary', () => {
  it('combines the month, cash, VAT estimate and open giros', async () => {
    const response = await app.send('GET', '/v1/reports/home-summary?date=2026-10-31')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      date: '2026-10-31',
      profitLoss: { month: '2026-10', revenueAmount: 44_000_000, netIncomeAmount: 23_030_000 },
      cash: { closingAmount: 73_450_000 },
      vat: {
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        estimatedTaxAmount: 1_500_000,
        dueDate: '2027-01-25',
        daysUntilDue: 86,
      },
      giros: { todoCount: 2, todoAmount: 1_262_500 },
    })
  })
})

describe('GET /v1/reports/labor-cost', () => {
  it('passes Payroll labor cost through for TAXATION subscribers', async () => {
    const response = await app.send('GET', '/v1/reports/labor-cost?year=2026')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ year: 2026, months: [{ month: '2026-10', employedCount: 2 }] })
  })

  it('requires the TAXATION plan', async () => {
    const response = await app.send('GET', '/v1/reports/labor-cost?year=2026', { token: 'noPlan' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
  })
})
