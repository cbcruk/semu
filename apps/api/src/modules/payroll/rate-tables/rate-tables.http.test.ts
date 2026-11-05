import { afterAll, describe, expect, it } from 'vitest'
import { payrollTestApp } from '../payroll-testing.ts'

const app = payrollTestApp()

afterAll(() => app.dispose())

describe('/rate-tables', () => {
  it('lists the built-in tables with unverified paths', async () => {
    const response = await app.request('GET', '/rate-tables')

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { effectiveFrom: string }) => item.effectiveFrom)).toEqual([
      '2026-01',
      '2026-03',
      '2026-07',
      '2026-11',
    ])
    expect(response.body.items[0]).toMatchObject({
      id: 'rtb_00000000000000000000202601',
      minimumWage: { hourly: 10_320, monthly: 2_156_880 },
    })
    expect(response.body.items[0].unverifiedPaths).toContain('longTermCare.ratioOfHealthPpm')
    expect(response.body.items[2]).toMatchObject({ nationalPension: { baseMin: 410_000, baseMax: 6_590_000 } })
    expect(response.body.items[2].unverifiedPaths).not.toContain('nationalPension.baseMax')
    expect(response.body.items[3].unverifiedPaths).not.toContain('longTermCare.ratioOfHealthPpm')
  })

  it('resolves the table in force in a month', async () => {
    const response = await app.request('GET', '/rate-tables?month=2026-09')

    expect(response.body.items.map((item: { effectiveFrom: string }) => item.effectiveFrom)).toEqual(['2026-07'])
  })

  it('answers 422 for a month before every table', async () => {
    const response = await app.request('GET', '/rate-tables?month=2020-01')

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'RATE_TABLE_NOT_FOUND', month: '2020-01' })
  })

  it('lists other income codes with expense rates', async () => {
    const response = await app.request('GET', '/payroll-reference-codes?month=2026-03')

    expect(response.status).toBe(200)
    expect(response.body.otherIncome[0]).toMatchObject({ code: '60', expenseRatePpm: 600_000, taxRatePpm: 200_000 })
  })
})

describe('/payroll-calculator:simulate', () => {
  it('calculates a monthly wage row with the legacy-verified amounts', async () => {
    const response = await app.request('POST', '/payroll-calculator:simulate', {
      body: {
        attributionMonth: '2026-03',
        row: {
          incomeType: 'WAGE_MONTHLY',
          basePay: 3_000_000,
          paymentItems: [{ code: 'MEAL', name: '식대', amount: 200_000, nonTaxableCategory: 'MEAL' }],
        },
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      grossPay: 3_200_000,
      taxablePay: 3_000_000,
      employeeInsurance: {
        nationalPension: 142_500,
        healthInsurance: 107_850,
        longTermCare: 14_170,
        employmentInsurance: 27_000,
      },
      incomeTax: 60_380,
      localIncomeTax: 6_030,
      netPay: 2_842_070,
    })
  })

  it('grosses up a business payment from the net amount', async () => {
    const response = await app.request('POST', '/payroll-calculator:simulate', {
      body: {
        attributionMonth: '2026-03',
        row: { incomeType: 'BUSINESS', payAmount: 967_000, taxDeductionMode: 'AFTER_TAX' },
      },
    })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ grossPay: 1_000_000, netPay: 967_000 })
  })
})
