import { beforeAll, describe, expect, it } from 'vitest'
import { CORP, createHrTestContext, type HrTestContext, USERS } from '../helpers/test-app'
import { type JsonCall, jsonClient, resultsOf } from './payroll-test-client'

describe('legacy payroll cards', () => {
  let ctx: HrTestContext
  let call: JsonCall
  let admin: string
  let agent: string
  let september: number
  let mealItemId: number

  const wageRows = (body: Record<string, unknown>): Record<string, unknown>[] => body['wage_salary'] as Record<string, unknown>[]

  beforeAll(async () => {
    ctx = await createHrTestContext()
    call = jsonClient(ctx, `/api/company/${CORP}/payroll`)
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
    const items = await ctx.call(admin, 'GET', `/api/company/${CORP}/employment/settings/payroll-payment-items`)
    const meal = ((await items.json()) as { results: { id: number; name: string }[] }).results.find((item) => item.name === '식대')
    mealItemId = meal?.id ?? 0
  })

  it('records the maintain-payroll choice outside the company mount', async () => {
    const path = `/api/company/new-payroll/maintain-payroll/${CORP}`
    expect(await (await ctx.call(admin, 'GET', path)).json()).toEqual({ maintain: false })
    expect((await ctx.call(admin, 'POST', path)).status).toBe(200)
    expect(await (await ctx.call(admin, 'GET', path)).json()).toEqual({ maintain: true })
    expect((await ctx.anonymous('GET', path)).status).toBe(401)
  })

  it('creates a default card from the roster, saves raw item amounts and calculates', async () => {
    const created = await call(admin, 'POST', '/cards', { attribution_month: '2026-09' })
    expect(created).toMatchObject({ status: 201, body: { status: 'input_available', kind: 'default', headcount: { wage_salary: 3 } } })
    september = created.body['id'] as number
    const minjun = wageRows(created.body).find((row) => row['name'] === '김민준') ?? {}

    const saved = await call(admin, 'POST', `/cards/${september}/data`, {
      wage_salary: [{ id: minjun['id'], taxable_incomes: { [String(mealItemId)]: 200_000 } }],
      daily: [{ name: '정일용', pay_amount: 600_000, work_days: 3 }],
      other_labor: [{ name: '윤기타', pay_amount: 300_000, other_income_type_code: '76' }],
    })
    expect(wageRows(saved.body).find((row) => row['id'] === minjun['id'])).toMatchObject({ taxable_incomes: { [String(mealItemId)]: 200_000 }, income_type: 'wage-salary' })
    expect((saved.body['other_labor'] as unknown[]).length).toBe(1)

    expect((await call(admin, 'PATCH', `/cards/${september}/update-name`, { name: '9월 급여' })).body['name']).toBe('9월 급여')
    const calculated = await call(admin, 'POST', `/cards/${september}/calculate`)
    expect(calculated.body).toMatchObject({ status: 'calculating', card_status: 'calculated' })
    const detail = await call(admin, 'GET', `/cards/${september}`)
    expect(wageRows(detail.body).find((row) => row['id'] === minjun['id'])).toMatchObject({ gross_pay: 4_400_000, non_taxable_pay: 200_000 })
    expect((await call(admin, 'GET', `/cards/${september}/card-status`)).body['status']).toBe('calculating')
  })

  it('fixes and releases cards only as agency staff', async () => {
    expect((await call(admin, 'POST', `/cards/${september}/extensions/fix`)).body['code']).toBe('PERMISSION_DENIED')
    expect((await call(agent, 'POST', `/cards/${september}/extensions/fix`)).body['status']).toBe('done')
    expect((await call(agent, 'POST', `/cards/${september}/extensions/release`)).body['status']).toBe('input_available')
    await call(admin, 'POST', `/cards/${september}/calculate`)
    await call(agent, 'POST', `/cards/${september}/extensions/fix`)
    const grouped = await call(admin, 'GET', '/card-summary/group-by-attr-date?fixed_cards_only=true')
    expect(resultsOf(grouped.body).map((group) => group['attr_date'])).toEqual(['2026-09'])
    expect((await call(admin, 'GET', '/cards/fixed-payrolls-with-keyword?income_type=daily&keyword=정')).body).toMatchObject({ results: [{ name: '정일용' }] })
    expect((await call(admin, 'GET', '/cards/employee-names?income_type=wage_salary')).body['results']).toEqual(['김민준', '이서연', '최유진'])
  })

  it('applies the additional card rules', async () => {
    expect((await call(admin, 'GET', `/cards/${september}/can-create-additional-card`)).body).toEqual({ can_create: false, reason: 'withholding_deadline_near' })
    const december = await call(admin, 'POST', '/cards', { attribution_month: '2026-12' })
    const decemberId = december.body['id'] as number
    expect((await call(admin, 'GET', `/cards/${decemberId}/can-create-additional-card`)).body).toEqual({ can_create: false, reason: 'parent_not_calculated' })
    await call(admin, 'POST', `/cards/${decemberId}/calculate`)
    expect((await call(admin, 'GET', `/cards/${decemberId}/can-create-additional-card`)).body).toEqual({ can_create: true, reason: null })
    const addition = await call(admin, 'POST', `/cards/${decemberId}/additional-card`)
    expect(addition).toMatchObject({ status: 201, body: { kind: 'addition', wage_salary: [] } })
    expect((await call(admin, 'DELETE', `/cards/${decemberId}`)).status).toBe(409)
    expect((await call(admin, 'DELETE', `/cards/${addition.body['id'] as number}`)).status).toBe(204)
  })

  it('copies the previous month and its payment formulas', async () => {
    await call(admin, 'POST', `/cards/${september}/payslip`, {
      wage_salary: wageRows((await call(admin, 'GET', `/cards/${september}`)).body).map((row) => ({ id: row['id'], payment_formulas: { 식대: '월 200,000원 정액' } })),
    })
    const october = await call(admin, 'POST', '/cards', { attribution_month: '2026-10' })
    const octoberId = october.body['id'] as number
    expect((await call(admin, 'GET', `/cards/${octoberId}/copy`)).body).toEqual({ can_copy: true, source_card_id: september })
    const copied = await call(admin, 'POST', `/cards/${octoberId}/copy`)
    expect(copied.body).toMatchObject({ updated: 3, created: 2 })
    const minjun = wageRows(copied.body['card'] as Record<string, unknown>).find((row) => row['name'] === '김민준')
    expect(minjun).toMatchObject({ taxable_incomes: { [String(mealItemId)]: 200_000 }, is_calculated: false })

    const formulas = await call(admin, 'POST', `/cards/${octoberId}/payslip/wage-salary/copy-payment-formulas`)
    expect(Object.values(formulas.body['results'] as Record<string, unknown>)).toContainEqual({ 식대: '월 200,000원 정액' })
    expect((await call(admin, 'GET', `/cards/${octoberId}/inquire-wage-employees-change`)).body).toEqual({ changed: false, added: [], removed: [] })
  })

  it('sends wage payslips and reports their notification statuses', async () => {
    const rows = wageRows((await call(admin, 'GET', `/cards/${september}`)).body)
    const ids = rows.map((row) => row['id'] as number)
    const sent = await call(admin, 'POST', `/cards/${september}/payslip/wage-salary/notifications`, { row_ids: ids })
    expect(resultsOf(sent.body).every((entry) => entry['status'] === 'success')).toBe(true)
    const statuses = await call(admin, 'GET', `/cards/${september}/payslip/wage-salary/notifications`)
    expect(resultsOf(statuses.body).map((entry) => entry['status'])).toEqual(['success', 'success', 'success'])
    expect((await call(admin, 'GET', `/cards/${september}/card-status`)).body).toMatchObject({ status: 'done', card_status: 'payslips_sent' })
  })
})
