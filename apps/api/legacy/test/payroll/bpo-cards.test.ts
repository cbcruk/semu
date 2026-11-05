import { beforeAll, describe, expect, it } from 'vitest'
import { CORP, createHrTestContext, type HrTestContext, USERS } from '../helpers/test-app'
import { cardOf, type JsonCall, jsonClient, resultsOf } from './payroll-test-client'

const BASE = `/api/company/${CORP}/payroll/bpo`
const SEEDED_OCTOBER = 1
const SEEDED_NOVEMBER = 2

describe('BPO payroll cards', () => {
  let ctx: HrTestContext
  let call: JsonCall
  let admin: string
  let agent: string
  let member: string

  beforeAll(async () => {
    ctx = await createHrTestContext()
    call = jsonClient(ctx, BASE)
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
    member = await ctx.token(USERS.plainMember, CORP)
  })

  it('lists the seeded cards and requires the payroll menu', async () => {
    const summary = await call(admin, 'GET', '/card-summary')
    expect(summary.status).toBe(200)
    expect(resultsOf(summary.body).map((card) => [card['attribution_month'], card['status']])).toEqual([
      ['2026-11', 'inputting'],
      ['2026-10', 'approved'],
    ])
    expect((await call(member, 'GET', '/card-summary')).status).toBe(403)
    expect((await call(admin, 'GET', '/card-summary/')).status).toBe(200)
  })

  it('offers this month and next month as payment dates', async () => {
    const { body } = await call(admin, 'GET', '/payment-date-list?attribution_month=2026-12')
    expect(body).toMatchObject({ default_payment_date: '2026-12-25' })
    expect(resultsOf(body).map((entry) => entry['payment_date'])).toEqual(['2026-12-25', '2027-01-25'])
  })

  it('runs the full lifecycle with actor permissions and version checks', async () => {
    const card = await call(admin, 'GET', `/card/${SEEDED_NOVEMBER}`)
    expect(card.etag).toBe('"1"')
    expect((await call(admin, 'PUT', `/card/${SEEDED_NOVEMBER}`, { status: 'calculated' })).status).toBe(428)
    expect((await call(admin, 'PUT', `/card/${SEEDED_NOVEMBER}`, { status: 'calculated' }, 9)).body['code']).toBe('VERSION_CONFLICT')

    const confirmed = await call(admin, 'PUT', `/card/${SEEDED_NOVEMBER}`, { status: 'calculated' }, 1)
    expect(confirmed).toMatchObject({ status: 200, etag: '"2"', body: { status: 'calculated', legacy_status: 'calculating', step: 2, uncalculated_count: 0 } })
    expect((await call(admin, 'PUT', `/card/${SEEDED_NOVEMBER}`, { status: 'inputting' }, 2)).body['code']).toBe('PERMISSION_DENIED')

    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/request-approval`, {}, 2)).body['code']).toBe('PERMISSION_DENIED')
    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/request-approval`, {})).status).toBe(428)
    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/request-approval`, {}, 2)).body).toMatchObject({ status: 'approval_requested', version: 3 })

    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/approve`, {}, 3)).body['code']).toBe('PERMISSION_DENIED')
    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/reject`, {}, 3)).body).toMatchObject({ status: 'calculated', version: 4 })
    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/request-approval`, {}, 4)).body['status']).toBe('approval_requested')
    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/cancel-approval`, {}, 5)).body).toMatchObject({ status: 'calculated', version: 6 })
    expect((await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/request-approval`, {}, 6)).body['status']).toBe('approval_requested')
    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/approve`, {}, 6)).body['code']).toBe('VERSION_CONFLICT')
    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/approve`, {}, 7)).body).toMatchObject({ status: 'approved', legacy_status: 'done', step: 3 })

    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/cancel-approval`, {}, 8)).body['status']).toBe('approval_requested')
    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/approve`, {}, 9)).body['status']).toBe('approved')

    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/export-to-desk?export_type=journal`, {}, 10)).body['code']).toBe('PERMISSION_DENIED')
    const exported = await call(agent, 'POST', `/card/${SEEDED_NOVEMBER}/export-to-desk?export_type=journal`, {}, 10)
    expect(exported.body).toMatchObject({ status: 'exported', export_type: 'journal' })
    expect((await call(admin, 'GET', `/card/${SEEDED_NOVEMBER}/status`)).body).toMatchObject({ status: 'exported', step: 3, version: 11 })
    expect((await call(admin, 'POST', `/card/${SEEDED_NOVEMBER}/cancel-approval`, {}, 11)).body['code']).toBe('INVALID_TRANSITION')
  })

  it('creates a card, enters every income type and matches the calculator', async () => {
    const created = await call(admin, 'POST', '/card', { attribution_month: '2026-12' })
    expect(created).toMatchObject({ status: 201, body: { kind: 'default', status: 'inputting', payment_date: '2026-12-25' } })
    const cardId = created.body['id'] as number

    const candidates = await call(admin, 'GET', `/card/${cardId}/wage-monthly/payroll-input/candidates`)
    const employeeIds = resultsOf(candidates.body).map((entry) => entry['employee_id'])
    expect(resultsOf(candidates.body).map((entry) => entry['name'])).toEqual(['김민준', '이서연', '최유진'])
    expect((await call(admin, 'POST', `/card/${cardId}/wage-monthly/payroll-input/candidates`, { employee_ids: employeeIds })).status).toBe(201)

    const wages = await call(admin, 'GET', `/card/${cardId}/wage-monthly/payroll-input`)
    const minjun = resultsOf(wages.body).find((row) => row['name'] === '김민준')
    expect(minjun).toMatchObject({ base_pay: 4_200_000, is_calculated: false })
    const minjunId = minjun?.['id'] as number
    await call(admin, 'PUT', `/card/${cardId}/wage-monthly/payroll-input/${minjunId}`, { base_pay: 3_000_000 })

    await call(admin, 'POST', `/card/${cardId}/daily/payroll-input`, { rows: [{ name: '정일용', pay_amount: 1_000_000, work_days: 5 }] })
    await call(admin, 'POST', `/card/${cardId}/business/payroll-input`, { rows: [{ name: '한사업', pay_amount: 1_000_000, business_income_type_code: '940909' }] })
    await call(admin, 'POST', `/card/${cardId}/other/payroll-input`, { rows: [{ name: '윤기타', pay_amount: 1_000_000, other_income_type_code: '76' }] })

    for (const segment of ['wage-monthly', 'daily', 'business', 'other']) {
      expect((await call(admin, 'POST', `/card/${cardId}/${segment}/payroll-input/calculate`, {})).status).toBe(200)
    }

    const simulate = async (json: unknown): Promise<Record<string, unknown>> => {
      const response = await ctx.call(admin, 'POST', '/api/payroll/calculator/simulate', { json })
      return (await response.json()) as Record<string, unknown>
    }
    const rowOf = async (segment: string, name: string): Promise<Record<string, unknown>> => {
      const row = resultsOf((await call(admin, 'GET', `/card/${cardId}/${segment}/payroll-input`)).body).find((entry) => entry['name'] === name)
      return row ?? {}
    }
    const amountsOf = (body: Record<string, unknown>): Record<string, unknown> => ({
      gross_pay: body['gross_pay'],
      income_tax: body['income_tax'],
      local_income_tax: body['local_income_tax'],
      net_pay: body['net_pay'],
    })

    const business = await rowOf('business', '한사업')
    expect(amountsOf(business)).toEqual({ gross_pay: 1_000_000, income_tax: 30_000, local_income_tax: 3_000, net_pay: 967_000 })
    expect(amountsOf(business)).toEqual(amountsOf(await simulate({ type: 'business', target_date: '202612', pay_amount: 1_000_000 })))

    const daily = await rowOf('daily', '정일용')
    expect(amountsOf(daily)).toMatchObject({ gross_pay: 1_000_000, income_tax: 6_750, local_income_tax: 670 })
    expect(daily['income_tax']).toBe((await simulate({ type: 'daily', target_date: '202612', daily_pay: 200_000, work_days: 5 }))['income_tax'])

    const other = await rowOf('other', '윤기타')
    expect(amountsOf(other)).toEqual(amountsOf(await simulate({ type: 'other', target_date: '202612', pay_amount: 1_000_000, income_type_code: '76' })))

    const wage = await rowOf('wage-monthly', '김민준')
    const wageSimulation = await simulate({ type: 'wage', target_date: '202612', monthly_pay: 3_000_000 })
    expect(wage['gross_pay']).toBe(3_000_000)
    expect(wage['income_tax']).toBe(wageSimulation['income_tax'])
    expect(wage['net_pay']).toBe((wage['gross_pay'] as number) - (wage['deduction_total'] as number))

    const header = cardOf((await call(admin, 'GET', `/card/${cardId}`)).body)
    expect(header['headcount_by_type']).toMatchObject({ 'wage-monthly': 3, daily: 1, business: 1, other: 1 })
  })

  it('applies the additional card rules', async () => {
    const blocked = await call(admin, 'POST', '/card', { attribution_month: '2026-12' })
    expect(blocked).toMatchObject({ status: 409, body: { code: 'ADDITIONAL_CARD_NOT_ALLOWED', reason: 'parent_not_calculated' } })

    const december = resultsOf((await call(admin, 'GET', '/card-summary?year=2026')).body).find((card) => card['attribution_month'] === '2026-12')
    const decemberId = december?.['id'] as number
    await call(admin, 'PUT', `/card/${decemberId}`, { status: 'calculated' }, december?.['version'] as number)

    const addition = await call(admin, 'POST', '/card', { attribution_month: '2026-12' })
    expect(addition).toMatchObject({ status: 201, body: { kind: 'addition', parent_card_id: decemberId } })
    const additionId = addition.body['id'] as number
    expect((await call(admin, 'POST', '/card', { attribution_month: '2026-12' })).body).toMatchObject({ reason: 'input_card_exists' })

    const wageCandidates = await call(admin, 'POST', `/card/${additionId}/wage-monthly/payroll-input/candidates`, { employee_ids: [1] })
    expect(wageCandidates).toMatchObject({ status: 409, body: { code: 'WAGE_INCOME_ON_ADDITIONAL_CARD' } })
    expect((await call(admin, 'POST', `/card/${additionId}/business/payroll-input`, { rows: [{ name: '추가사업', pay_amount: 500_000 }] })).status).toBe(200)

    expect((await call(admin, 'DELETE', `/card/${additionId}`)).status).toBe(204)
    expect((await call(admin, 'DELETE', `/card/${SEEDED_OCTOBER}`)).body['code']).toBe('INVALID_TRANSITION')
  })

  it('sends payslips with per-row statuses and downloads them as PDF', async () => {
    expect((await call(admin, 'POST', `/card/${SEEDED_OCTOBER}/payslip/send`, { row_ids: [1, 2, 3] })).status).toBe(200)
    ctx.db.prepare("UPDATE payroll_rows SET email = 'broken@fail.invalid' WHERE card_id = ? AND name = '최유진'").run(SEEDED_OCTOBER)
    ctx.db.prepare("UPDATE payroll_payslips SET email = NULL WHERE card_id = ?").run(SEEDED_OCTOBER)
    const sent = await call(admin, 'POST', `/card/${SEEDED_OCTOBER}/payslip/send`, { row_ids: [1, 3] })
    expect(resultsOf(sent.body)).toEqual([
      { row_id: 1, notification_status: 'success', fail_reason: null },
      { row_id: 3, notification_status: 'fail', fail_reason: expect.any(String) },
    ])
    expect(cardOf(sent.body)['status']).toBe('payslips_sent')
    const list = resultsOf((await call(admin, 'GET', `/card/${SEEDED_OCTOBER}/wage/payslip`)).body)
    expect(list.map((row) => row['notification_status'])).toEqual(['success', 'success', 'fail'])
    expect(ctx.notifier.outbox.some((message) => message.template === 'payroll_payslip')).toBe(true)

    const detail = await call(admin, 'GET', `/card/${SEEDED_OCTOBER}/wage/payslip/1`)
    expect(detail.body).toMatchObject({ name: '김민준', gross_pay: 4_200_000 })

    const pdf = await ctx.call(admin, 'POST', `${BASE}/card/${SEEDED_OCTOBER}/payslip/download`, { json: { row_ids: [1] } })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf')
    expect((await call(admin, 'POST', `/card/${SEEDED_OCTOBER + 4}/payslip/send`, { row_ids: [1] })).status).toBe(404)
  })

  it('keeps the manager memo agency-only and blocks Shiftee re-linking', async () => {
    expect((await call(admin, 'POST', '/manager-memo', { content: '메모' })).body['code']).toBe('PERMISSION_DENIED')
    expect((await call(agent, 'POST', '/manager-memo', { content: '11월 상여 확인' })).body['content']).toBe('11월 상여 확인')
    expect((await call(admin, 'GET', '/manager-memo')).body['content']).toBe('11월 상여 확인')

    expect((await call(admin, 'GET', '/shiftee-integration')).body).toMatchObject({ status: 'none', can_link: true })
    expect((await call(admin, 'POST', '/shiftee-integration', { email: 'hr@example.com' })).body).toMatchObject({ status: 'linked' })
    expect((await call(admin, 'DELETE', '/shiftee-integration')).body).toMatchObject({ status: 'unlinked', can_link: false })
    expect((await call(admin, 'POST', '/shiftee-integration', { email: 'hr@example.com' })).body['code']).toBe('SHIFTEE_RELINK_BLOCKED')
  })
})
