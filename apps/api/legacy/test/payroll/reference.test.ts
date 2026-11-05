import { beforeAll, describe, expect, it } from 'vitest'
import { decide } from '../../src/modules/access/access'
import type { AccessContext } from '../../src/modules/access/access.types'
import { createTestContext, type TestContext, USERS } from '../helpers/test-app'

describe('payroll reference data and calculator', () => {
  let ctx: TestContext
  let token: string

  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    const response = await ctx.call(token, 'GET', path)
    return { status: response.status, body: await response.json() }
  }
  const simulate = async (json: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await ctx.call(token, 'POST', '/api/payroll/calculator/simulate', { json })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  beforeAll(async () => {
    ctx = await createTestContext({ schedule: false })
    token = await ctx.token(USERS.freeAdmin, 'c-free')
  })

  it('requires authentication', async () => {
    expect((await ctx.app.request('/api/payroll/nation-codes')).status).toBe(401)
    expect((await ctx.app.request('/api/payroll/calculator/simulate', { method: 'POST' })).status).toBe(401)
  })

  it.each([
    {
      label: 'wage 3,000,000 + meal 200,000, one dependant',
      body: { type: 'wage', target_date: '202603', monthly_pay: 3_000_000, meal_allowance: 200_000, dependants: 1 },
      expected: {
        gross_pay: 3_200_000,
        taxable_pay: 3_000_000,
        national_pension: 142_500,
        health_insurance: 107_850,
        long_term_care_insurance: 14_170,
        employment_insurance: 27_000,
        income_tax: 60_380,
        local_income_tax: 6_030,
        net_pay: 2_842_070,
      },
    },
    {
      label: 'wage with a trusted non-taxable amount',
      body: { type: 'wage', monthly_pay: 3_000_000, non_taxable_pay: 500_000 },
      expected: { gross_pay: 3_500_000, taxable_pay: 3_000_000, non_taxable_pay: 500_000 },
    },
    {
      label: 'daily 200,000 × 5 days',
      body: { type: 'daily', daily_pay: 200_000, work_days: 5 },
      expected: { gross_pay: 1_000_000, employment_insurance: 9_000, income_tax: 6_750, local_income_tax: 670, net_pay: 983_580 },
    },
    { label: 'business 1,000,000', body: { type: 'business', pay_amount: 1_000_000 }, expected: { income_tax: 30_000, local_income_tax: 3_000, net_pay: 967_000 } },
    { label: 'business after tax', body: { type: 'business', pay_amount: 967_000, tax_deduction_mode: 'after_tax' }, expected: { gross_pay: 1_000_000 } },
    { label: 'other 1,000,000 at the default 60% expense type', body: { type: 'other', pay_amount: 1_000_000 }, expected: { income_tax: 80_000, net_pay: 912_000 } },
    { label: 'other without expenses', body: { type: 'other', pay_amount: 1_000_000, income_type_code: '62' }, expected: { income_tax: 200_000, net_pay: 780_000 } },
    {
      label: 'other with an explicit expense rate',
      body: { type: 'other', pay_amount: 1_000_000, necessary_expense_rate: 80 },
      expected: { income_tax: 40_000, local_income_tax: 4_000 },
    },
  ])('simulates $label', async ({ body, expected }) => {
    const response = await simulate(body)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject(expected)
  })

  it('returns snake_case keys, employer shares and the breakdown', async () => {
    const { body } = await simulate({ type: 'wage', monthly_pay: 3_000_000 })
    expect(body).toMatchObject({ type: 'wage', income_type: 'wage_monthly', attribution_month: '2026-11', rate_table: '2026-07' })
    expect(body['employer']).toMatchObject({ national_pension: 142_500, employment_insurance: 34_500 })
    expect((body['breakdown'] as { code: string }[]).map((entry) => entry.code)).toContain('income_tax')
  })

  it('validates the simulation body', async () => {
    expect((await simulate({ type: 'salary', monthly_pay: 1 })).status).toBe(422)
    expect((await simulate({ type: 'wage', monthly_pay: -1 })).status).toBe(422)
    expect((await simulate({ type: 'wage', monthly_pay: 1, target_date: '2026-03' })).status).toBe(422)
    expect((await simulate({ type: 'other', pay_amount: 1, income_type_code: 'zz' })).body).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('lists reference codes by target date', async () => {
    const business = (await get('/api/payroll/business-income-types/?target_date=202611')).body as { code: string; name: string; detail_type: string | null }[]
    expect(business.find((type) => type.name === '기타자영업(프리랜서)')).toMatchObject({ detail_type: null })
    expect(business.find((type) => type.name === '가수')).toMatchObject({ detail_type: 'artist' })
    expect(((await get('/api/payroll/business-income-types?target_date=202301')).body as unknown[]).length).toBe(0)
    const other = (await get('/api/payroll/other-labor-income-types?target_date=202611')).body as { code: string; necessary_expense_rate: number | null }[]
    expect(other.find((type) => type.code === '60')?.necessary_expense_rate).toBe(60)
    expect(((await get('/api/payroll/special-occ-types')).body as unknown[]).length).toBeGreaterThan(0)
    expect((await get('/api/payroll/nation-codes')).body).toContainEqual({ code: 'KR', name: '대한민국' })
    expect((await get('/api/payroll/business-income-types?target_date=202613')).status).toBe(422)
  })

  it('serves the simple tax table and single lookups', async () => {
    expect((await get('/api/tax-rates/simple?target_date=202603&monthly_pay=3000000&dependants=1')).body).toMatchObject({
      target_date: '202603',
      rate_table: '2026-01',
      income_tax: 60_380,
      local_income_tax: 6_030,
      verified: false,
    })
    const table = (await get('/api/tax-rates/simple')).body as { rows: { min: number; max: number; taxes: number[] }[] }
    expect(table.rows).toHaveLength(646)
    expect(table.rows.find((row) => row.min === 3_000_000)?.taxes[0]).toBe(60_380)
    const expenses = (await get('/api/tax-rates/necessary-expenses')).body as { income_type_code: string; necessary_expense_rate: number | null }[]
    expect(expenses.find((entry) => entry.income_type_code === '62')?.necessary_expense_rate).toBe(0)
  })

  it('downloads the upload template and parses uploaded sheets', async () => {
    const template = await ctx.call(token, 'GET', '/api/payroll/excel/')
    expect(template.headers.get('Content-Type')).toContain('text/csv')
    const text = await template.text()
    expect(text.split('\r\n')[0]).toContain('소득유형,성명')

    const sheet = `${text}사업,김작가,800101-2000000,내국인,KR,2026-11-10,"1,000,000",,940909,\r\n기타,,,,,,abc,,,\r\n`
    const form = new FormData()
    form.append('file', new File([sheet], 'sheet.csv'))
    const response = await ctx.call(token, 'POST', '/api/payroll/excel', { form })
    const parsed = (await response.json()) as { rows: { income_type: string; pay_amount: number; business_income_type_code: string | null }[]; errors: { row_number: number }[] }
    expect(parsed.rows.map((row) => [row.income_type, row.pay_amount, row.business_income_type_code])).toEqual([
      ['daily', 1_000_000, null],
      ['business', 1_000_000, '940909'],
    ])
    expect(parsed.errors.map((error) => error.row_number)).toEqual([4])
  })

  it('applies the payroll menu plan rules', () => {
    const context = (overrides: Partial<AccessContext>): AccessContext => ({
      userId: 'u',
      actor: 'client',
      isAdmin: true,
      roleMenuCodes: new Set(),
      businessType: 'corporate',
      taxPlan: null,
      hasPayrollPlan: false,
      taxTermsAgreed: true,
      ...overrides,
    })
    const free = context({})
    const payroll = context({ hasPayrollPlan: true })
    const taxation = context({ taxPlan: 'taxation' })
    expect(decide(free, 'salary_calculator').ok).toBe(true)
    expect(decide(free, 'payroll_setting')).toMatchObject({ ok: false, reason: 'ENTITLEMENT_REQUIRED' })
    expect(decide(payroll, 'payroll_setting').ok).toBe(true)
    expect(decide(payroll, 'payroll_settlement').ok).toBe(true)
    expect(decide(taxation, 'payroll_settlement').ok).toBe(false)
    expect(decide(taxation, 'payroll_management').ok).toBe(true)
    expect(decide(payroll, 'payroll_management').ok).toBe(false)
  })

  it('seeds the rate tables into the database', () => {
    const rows = ctx.db.prepare('SELECT effective_from FROM payroll_rate_tables ORDER BY effective_from').all() as { effective_from: string }[]
    expect(rows.map((row) => row.effective_from)).toEqual(['2026-01', '2026-07'])
  })
})
