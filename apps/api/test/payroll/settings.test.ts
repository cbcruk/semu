import { beforeAll, describe, expect, it } from 'vitest'
import { SEED } from '../../src/db/seed'
import { DomainError } from '../../src/lib/domain-error'
import { removeWorkSchedulePolicy } from '../../src/modules/payroll/settings/settings.service'
import { CORP, createTestContext, grantPayrollPlan, type TestContext, USERS } from '../helpers/test-app'

const BASE = `/api/company/${CORP}/employment/settings`

interface Page<T> {
  count: number
  results: T[]
}

interface PaymentItem {
  id: number
  name: string
  catalog_code: string | null
  is_taxable: boolean
  is_system: boolean
  non_taxable_category: string | null
  statutory_non_taxable_limit: number | null
  non_taxable_limit_amount: number | null
  default_amount: number | null
  include_in_ordinary_wage: boolean
}

describe('payroll settings', () => {
  let ctx: TestContext
  let admin: string

  const call = async (method: string, path: string, json?: unknown, token = admin): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await ctx.call(token, method, `${BASE}${path}`, json === undefined ? {} : { json })
    const text = await response.text()
    return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>) }
  }
  const errorsOf = (body: Record<string, unknown>): Record<string, string[]> => body['errors'] as Record<string, string[]>

  beforeAll(async () => {
    ctx = await createTestContext({ schedule: false })
    admin = await ctx.token(USERS.admin, CORP)
  })

  it('requires the payroll plan, then the menu permission', async () => {
    expect(await call('GET', '/payroll-terms')).toMatchObject({ status: 403, body: { code: 'ENTITLEMENT_REQUIRED' } })
    grantPayrollPlan(ctx.db, CORP)
    expect((await call('GET', '/payroll-terms')).status).toBe(200)
    expect((await call('GET', '/payroll-terms', undefined, await ctx.token(USERS.plainMember, CORP))).body['code']).toBe('PERMISSION_DENIED')
    expect((await call('GET', '/payroll-terms/', undefined, await ctx.token(USERS.agent))).status).toBe(200)
    expect((await call('PATCH', '/payroll-terms', { payment_day: 10 }, await ctx.token(USERS.demo, CORP))).body['code']).toBe('DEMO_READ_ONLY')
  })

  it('seeds the default payment items with standard non-taxable names', async () => {
    const { body } = await call('GET', '/payroll-payment-items')
    const page = body as unknown as Page<PaymentItem>
    expect(page.results.map((item) => item.name)).toEqual(['기본급', '연장근로수당', '야간근로수당', '휴일근로수당', '휴일연장근로수당', '연차수당', '식대'])
    expect(page.results[0]).toMatchObject({ is_system: true, include_in_ordinary_wage: true })
    expect(page.results.find((item) => item.name === '식대')).toMatchObject({ is_taxable: false, non_taxable_category: 'meal', statutory_non_taxable_limit: 200_000 })
    const nonTaxable = (await call('GET', '/payroll-payment-items?is_taxable=false')).body as unknown as Page<PaymentItem>
    expect(nonTaxable.results.map((item) => item.name)).toEqual(['식대'])
    expect(((await call('GET', '/payroll-payment-items?search=휴일')).body as unknown as Page<PaymentItem>).count).toBe(2)
  })

  it('lists the catalog with statutory limits', async () => {
    const { body } = await call('GET', '/payroll-payment-categories?is_taxable=false')
    const results = (body as unknown as Page<{ name: string; statutory_monthly_limit: number | null; standard_name_required: boolean }>).results
    expect(results.find((item) => item.name === '연구수당')).toMatchObject({ statutory_monthly_limit: 200_000, standard_name_required: true })
    expect(results.every((item) => item.standard_name_required)).toBe(true)
  })

  it('creates catalog and custom payment items and enforces the payment item rules', async () => {
    const research = await call('POST', '/payroll-payment-items', {
      name: '연구수당',
      source: 'catalog',
      catalog_code: 'research',
      non_taxable_limit_enabled: true,
      non_taxable_limit_amount: 150_000,
    })
    expect(research).toMatchObject({ status: 201, body: { is_taxable: false, non_taxable_category: 'research', non_taxable_limit_amount: 150_000 } })

    const custom = await call('POST', '/payroll-payment-items', { name: '자기계발비', source: 'custom', default_amount: 50_000, include_in_ordinary_wage: true })
    expect(custom).toMatchObject({ status: 201, body: { is_taxable: true, catalog_code: null, default_amount: 50_000, include_in_ordinary_wage: true } })

    const rejected: [unknown, string][] = [
      [{ name: '연구비', source: 'catalog', catalog_code: 'research' }, 'name'],
      [{ name: '차량유지비', source: 'catalog', catalog_code: 'vehicle', non_taxable_limit_enabled: true, non_taxable_limit_amount: 300_000 }, 'non_taxable_limit_amount'],
      [{ name: '교통비', source: 'custom', is_taxable: false }, 'is_taxable'],
      [{ name: '식대', source: 'custom' }, 'name'],
      [{ name: '자기계발비', source: 'custom' }, 'name'],
      [{ name: '없는항목', source: 'catalog', catalog_code: 'nope' }, 'catalog_code'],
      [{ name: '상여금', source: 'catalog', catalog_code: 'bonus', is_taxable: false }, 'is_taxable'],
      [{ name: '자격수당', source: 'catalog', catalog_code: 'qualification_allowance', show_formula_on_payslip: true }, 'formula_text'],
      [{ name: '자격수당', source: 'catalog', catalog_code: 'qualification_allowance', non_taxable_limit_enabled: true, non_taxable_limit_amount: 1 }, 'non_taxable_limit_enabled'],
    ]
    for (const [json, field] of rejected) {
      const response = await call('POST', '/payroll-payment-items', json)
      expect(response.status, JSON.stringify(json)).toBe(422)
      expect(Object.keys(errorsOf(response.body)), JSON.stringify(json)).toContain(field)
    }
    expect((await call('POST', '/payroll-payment-items', { name: '', source: 'custom' })).status).toBe(422)

    const id = custom.body['id'] as number
    expect((await call('PATCH', `/payroll-payment-items/${id}`, { default_amount: 70_000, formula_text: '월 7만원 정액' })).body).toMatchObject({
      default_amount: 70_000,
      formula_text: '월 7만원 정액',
    })
    expect((await call('GET', `/payroll-payment-items/${id}`)).body['name']).toBe('자기계발비')
    expect((await call('DELETE', `/payroll-payment-items/${id}`)).status).toBe(204)
    expect((await call('GET', `/payroll-payment-items/${id}`)).status).toBe(404)
  })

  it('protects the system base pay item', async () => {
    const items = (await call('GET', '/payroll-payment-items')).body as unknown as Page<PaymentItem>
    const base = items.results.find((item) => item.is_system)
    expect(base).toBeDefined()
    expect(await call('DELETE', `/payroll-payment-items/${base?.id}`)).toMatchObject({ status: 409, body: { code: 'INVALID_TRANSITION' } })
    expect(Object.keys(errorsOf((await call('PATCH', `/payroll-payment-items/${base?.id}`, { name: '본봉' })).body))).toContain('name')
    expect((await call('PATCH', `/payroll-payment-items/${base?.id}`, { include_in_average_wage: false })).status).toBe(200)
  })

  it('keeps settings scoped to the company', async () => {
    const items = (await call('GET', '/payroll-payment-items')).body as unknown as Page<PaymentItem>
    const individual = SEED.companies.individual
    grantPayrollPlan(ctx.db, individual)
    const token = await ctx.token(USERS.individualAdmin, individual)
    const response = await ctx.call(token, 'GET', `/api/company/${individual}/employment/settings/payroll-payment-items/${items.results[0]?.id}`)
    expect(response.status).toBe(404)
    const own = (await (await ctx.call(token, 'GET', `/api/company/${individual}/employment/settings/payroll-payment-items`)).json()) as Page<PaymentItem>
    expect(own.count).toBe(7)
  })

  it('reads and updates the deduction settings and deduction items', async () => {
    expect((await call('GET', '/payroll-deduction')).body).toMatchObject({
      national_pension_method: 'notice',
      national_pension_pay_on_acquisition_month: false,
      health_insurance_method: 'notice',
      employment_insurance_method: 'rate',
      income_tax_method: 'tax_table_based',
    })
    expect((await call('PATCH', '/payroll-deduction', { health_insurance_method: 'rate', national_pension_pay_on_acquisition_month: true })).body).toMatchObject({
      health_insurance_method: 'rate',
      national_pension_pay_on_acquisition_month: true,
      national_pension_method: 'notice',
    })
    expect((await call('PATCH', '/payroll-deduction', { income_tax_method: 'table' })).status).toBe(422)

    const created = await call('POST', '/payroll-deduction-items', { name: '선지급금', amount_mode: 'on_settlement', amount: 10_000 })
    expect(created).toMatchObject({ status: 201, body: { amount_mode: 'on_settlement', amount: null } })
    expect(Object.keys(errorsOf((await call('POST', '/payroll-deduction-items', { name: '동호회비', amount_mode: 'fixed' })).body))).toEqual(['amount'])
    expect(Object.keys(errorsOf((await call('POST', '/payroll-deduction-items', { name: '선지급금', amount_mode: 'on_settlement' })).body))).toEqual(['name'])
    const id = created.body['id'] as number
    expect((await call('PATCH', `/payroll-deduction-items/${id}`, { amount_mode: 'fixed', amount: 30_000 })).body).toMatchObject({ amount_mode: 'fixed', amount: 30_000 })
    expect(((await call('GET', '/payroll-deduction-items')).body as unknown as Page<unknown>).count).toBe(1)
    expect((await call('DELETE', `/payroll-deduction-items/${id}`)).status).toBe(204)
    expect((await call('DELETE', `/payroll-deduction-items/${id}`)).status).toBe(404)
  })

  it('serves payroll terms with the minimum wage and resets multipliers when the company size changes', async () => {
    expect((await call('GET', '/payroll-terms')).body).toMatchObject({
      wage_period_start_day: 1,
      payment_month: 'current',
      is_under_five_employees: false,
      fixed_overtime_multiplier: 1.5,
      fixed_night_multiplier: 0.5,
      fixed_holiday_multiplier: 1.5,
      fixed_holiday_overtime_multiplier: 2,
      retirement_benefit_type: 'grant',
      minimum_wage: { year: 2026, hourly_wage: 10_320, monthly_wage: 2_156_880, monthly_hours: 209 },
    })
    expect((await call('PATCH', '/payroll-terms', { is_under_five_employees: true, payment_month: 'next', payment_day: 31 })).body).toMatchObject({
      is_under_five_employees: true,
      payment_month: 'next',
      payment_day: 31,
      fixed_overtime_multiplier: 1,
      fixed_night_multiplier: 0,
      fixed_holiday_multiplier: 1,
      fixed_holiday_overtime_multiplier: 1,
    })
    expect((await call('PATCH', '/payroll-terms', { fixed_overtime_multiplier: 1.25 })).body['fixed_overtime_multiplier']).toBe(1.25)
    expect((await call('PATCH', '/payroll-terms', { fixed_overtime_multiplier: 1.255 })).status).toBe(422)
    expect((await call('PATCH', '/payroll-terms', { payment_day: 32 })).status).toBe(422)
  })

  it('manages work conditions with usage status', async () => {
    const list = (await call('GET', '/work-conditions')).body as unknown as Page<{ name: string }>
    expect(list.results.map((item) => item.name)).toEqual(['기본 근로조건'])
    const created = await call('POST', '/work-conditions', { name: '수습 3개월', work_place: '본사', probation_months: 3, probation_pay_rate: 90 })
    expect(created).toMatchObject({ status: 201, body: { probation_months: 3, probation_pay_rate: 90, is_active: true } })
    const id = created.body['id'] as number
    expect((await call('PATCH', `/work-conditions/${id}`, { probation_months: 0 })).body).toMatchObject({ probation_months: 0, probation_pay_rate: 100 })
    expect((await call('PATCH', `/work-conditions/${id}`, { probation_pay_rate: 0 })).status).toBe(422)
    expect((await call('GET', `/work-conditions/${id}/usage-status`)).body).toEqual({ id, is_active: true, usage_count: 0, in_use: false })
    expect((await call('PATCH', `/work-conditions/${id}/usage-status`, { is_active: false })).body).toMatchObject({ is_active: false, usage_count: 0 })
    expect(((await call('GET', '/work-conditions?is_active=false')).body as unknown as Page<unknown>).count).toBe(1)
    expect((await call('DELETE', `/work-conditions/${id}`)).status).toBe(204)
    expect((await call('GET', `/work-conditions/${id}`)).status).toBe(404)
  })

  it('derives contractual hours of work schedule policies', async () => {
    const list = (await call('GET', '/work-schedule-policies')).body as unknown as Page<Record<string, unknown>>
    expect(list.results[0]).toMatchObject({
      name: '주 5일 40시간',
      weekly_contractual_hours: 40,
      weekly_rest_hours: 8,
      work_days_per_week: 5,
      monthly_standard_hours: 209,
    })
    const partTime = {
      name: '주 4일 20시간',
      paid_weekly_holidays: [6],
      unpaid_holidays: [4, 5],
      contractual_work_schedule_type: 'weekly',
      contractual_work_schedules: [0, 1, 2, 3].map((day) => ({ week: 1, day_of_week: day, hours: 5 })),
      weekly_rest_hours_input_method: 'auto_calculated',
      fixed_overtime_work_schedule_type: 'weekly',
      fixed_overtime_input_type: 'actual',
      fixed_overtime_items: [{ work_type: 'extended', hours: 2 }],
    }
    const created = await call('POST', '/work-schedule-policies', partTime)
    expect(created).toMatchObject({
      status: 201,
      body: { weekly_contractual_hours: 20, weekly_rest_hours: 4, work_days_per_week: 4, monthly_standard_hours: 104, fixed_overtime_items: [{ work_type: 'extended', day_of_week: null, hours: 2 }] },
    })
    const id = created.body['id'] as number
    const replaced = await call('PUT', `/work-schedule-policies/${id}`, { ...partTime, weekly_rest_hours_input_method: 'manual', weekly_rest_hours: 5 })
    expect(replaced.body).toMatchObject({ weekly_rest_hours: 5, monthly_standard_hours: 109 })
    const biweekly = await call('POST', '/work-schedule-policies', {
      ...partTime,
      name: '격주 토요 근무',
      unpaid_holidays: [],
      contractual_work_schedule_type: 'biweekly',
      contractual_work_schedules: [
        ...[0, 1, 2, 3, 4].flatMap((day) => [1, 2].map((week) => ({ week, day_of_week: day, hours: 7 }))),
        { week: 1, day_of_week: 5, hours: 4 },
      ],
      fixed_overtime_work_schedule_type: 'none',
      fixed_overtime_input_type: 'none',
      fixed_overtime_items: [],
    })
    expect(biweekly.body).toMatchObject({ weekly_contractual_hours: 37, work_days_per_week: 5.5 })

    expect((await call('GET', `/work-schedule-policies/${id}/usage-status`)).body).toEqual({ id, is_active: true, usage_count: 0, in_use: false })
    expect((await call('PATCH', `/work-schedule-policies/${id}/usage-status`, { is_active: false })).body).toMatchObject({ is_active: false, in_use: false })
    expect((await call('DELETE', `/work-schedule-policies/${id}`)).status).toBe(204)
  })

  it.each([
    ['overlapping holidays', { paid_weekly_holidays: [6], unpaid_holidays: [6] }, 'unpaid_holidays'],
    ['hours on a holiday', { contractual_work_schedules: [{ week: 1, day_of_week: 6, hours: 8 }] }, 'contractual_work_schedules'],
    ['a week outside the cycle', { contractual_work_schedules: [{ week: 2, day_of_week: 0, hours: 8 }] }, 'contractual_work_schedules'],
    ['manual rest without hours', { weekly_rest_hours_input_method: 'manual' }, 'weekly_rest_hours'],
    ['no paid weekly holiday at 40 hours', { paid_weekly_holidays: [] }, 'paid_weekly_holidays'],
    ['fixed overtime fields that disagree', { fixed_overtime_work_schedule_type: 'daily', fixed_overtime_input_type: 'none' }, 'fixed_overtime_input_type'],
    [
      'daily fixed overtime without a day',
      { fixed_overtime_work_schedule_type: 'daily', fixed_overtime_input_type: 'additional', fixed_overtime_items: [{ work_type: 'night', hours: 1 }] },
      'fixed_overtime_items',
    ],
  ])('rejects a work schedule policy with %s', async (_label, overrides, field) => {
    const body = {
      name: '검증',
      paid_weekly_holidays: [6],
      unpaid_holidays: [5],
      contractual_work_schedule_type: 'weekly',
      contractual_work_schedules: [0, 1, 2, 3, 4].map((day) => ({ week: 1, day_of_week: day, hours: 8 })),
      weekly_rest_hours_input_method: 'auto_calculated',
      fixed_overtime_work_schedule_type: 'none',
      fixed_overtime_input_type: 'none',
      ...overrides,
    }
    const response = await call('POST', '/work-schedule-policies', body)
    expect(response.status).toBe(422)
    expect(Object.keys(errorsOf(response.body))).toContain(field)
  })

  it('refuses to delete settings the usage counter reports as in use', async () => {
    const list = (await call('GET', '/work-schedule-policies')).body as unknown as Page<{ id: number }>
    const id = list.results[0]?.id ?? 0
    const counter = { workConditionUsages: (): number => 0, workSchedulePolicyUsages: (): number => 3 }
    expect(() => removeWorkSchedulePolicy(ctx.db, CORP, id, counter)).toThrow(DomainError)
  })
})
