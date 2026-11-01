import { beforeAll, describe, expect, it } from 'vitest'
import { CORP, createHrTestContext, type HrTestContext, USERS } from '../helpers/test-app'
import { type JsonCall, jsonClient, resultsOf } from './payroll-test-client'

describe('severance settlements', () => {
  let ctx: HrTestContext
  let call: JsonCall
  let admin: string
  let agent: string

  const hrStatus = (employeeId: number): unknown =>
    (ctx.db.prepare('SELECT severance_settlement_status FROM employee_retirement_infos WHERE company_id = ? AND employee_id = ?').get(CORP, employeeId) as
      | { severance_settlement_status: string | null }
      | undefined)?.severance_settlement_status

  beforeAll(async () => {
    ctx = await createHrTestContext()
    call = jsonClient(ctx, `/api/company/${CORP}/payroll/bpo/severance/settlements`)
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
  })

  it('settles a retirement from three months of wages and mirrors the status to HR', async () => {
    const candidates = resultsOf((await call(agent, 'GET', '/retirement-candidates')).body)
    expect(candidates.map((entry) => [entry['name'], entry['base_date'], entry['service_days']])).toEqual([['박지훈', '2025-12-31', 1823]])

    expect((await call(admin, 'POST', '', { kind: 'retirement', employee_ids: [3] })).body['code']).toBe('PERMISSION_DENIED')
    const created = await call(agent, 'POST', '', { kind: 'retirement', employee_ids: [3] })
    const settlement = resultsOf(created.body)[0] ?? {}
    const averageDaily = Math.floor((3_800_000 * 3) / (31 + 30 + 31))
    expect(settlement).toMatchObject({
      status: 'in_progress',
      three_month_wages: 11_400_000,
      average_daily_wage: averageDaily,
      severance_pay: Math.floor(((3_800_000 * 3) / 92) * 30 * (1823 / 365)),
    })
    expect(settlement['net_pay']).toBe((settlement['severance_pay'] as number) - (settlement['retirement_income_tax'] as number) - (settlement['local_income_tax'] as number))
    expect(hrStatus(3)).toBe('in_progress')

    const id = settlement['id'] as number
    expect((await call(agent, 'POST', `/${id}/complete`, {})).status).toBe(428)
    const completed = await call(agent, 'POST', `/${id}/complete`, { annual_leave_pay: 300_000 }, 1)
    expect(completed).toMatchObject({ status: 200, etag: '"2"', body: { status: 'completed', annual_leave_pay: 300_000 } })
    expect(completed.body['severance_pay'] as number).toBeGreaterThan(settlement['severance_pay'] as number)
    expect(hrStatus(3)).toBe('completed')

    expect((await call(agent, 'POST', `/${id}/reopen`, {}, 1)).body['code']).toBe('VERSION_CONFLICT')
    expect((await call(agent, 'POST', `/${id}/reopen`, {}, 2)).body['status']).toBe('in_progress')
    expect((await call(agent, 'POST', `/${id}/exclude`, { reason: '퇴직연금 가입' }, 3)).body).toMatchObject({ status: 'excluded', exclude_reason: '퇴직연금 가입' })
    expect(hrStatus(3)).toBe('excluded')
    expect((await call(agent, 'POST', `/${id}/include`, {}, 4)).body['status']).toBe('in_progress')
    expect((await call(admin, 'GET', '/status-counts')).body).toMatchObject({ in_progress: 1 })
  })

  it('offers the nine interim reasons and settles an interim payment', async () => {
    const options = (await call(admin, 'GET', '/filter-options')).body
    expect((options['interim_reasons'] as unknown[]).length).toBe(9)
    expect((await call(agent, 'POST', '', { kind: 'interim', employee_ids: [1] })).status).toBe(422)

    const candidates = resultsOf((await call(agent, 'GET', '/interim-candidates?base_date=2026-10-31')).body)
    expect(candidates.map((entry) => entry['name'])).toEqual(['김민준', '이서연'])
    const created = await call(agent, 'POST', '', { kind: 'interim', employee_ids: [1], reason: 'home_purchase', base_date: '2026-10-31' })
    const interim = resultsOf(created.body)[0] ?? {}
    expect(interim).toMatchObject({ kind: 'interim', interim_reason: 'home_purchase', base_date: '2026-10-31', service_start_date: '2023-03-02' })
    const months = (await call(admin, 'GET', `/${interim['id'] as number}/monthly-wages`)).body
    expect(resultsOf(months).map((entry) => entry['month'])).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(resultsOf(months).find((entry) => entry['month'] === '2026-10')).toMatchObject({ total: 4_200_000, source: 'payroll' })

    const completed = await call(agent, 'POST', `/${interim['id'] as number}/complete`, {}, interim['version'] as number)
    expect(completed.body['status']).toBe('completed')
    expect(hrStatus(1)).not.toBe('completed')
    expect((await call(agent, 'DELETE', `/${interim['id'] as number}`)).status).toBe(409)
  })
})
