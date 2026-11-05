import { beforeAll, describe, expect, it } from 'vitest'
import { scheduleFilings } from '../../src/jobs/schedule-filings'
import { CORP, createHrTestContext, type HrTestContext, USERS } from '../helpers/test-app'
import { fileWithholding, type JsonCall, jsonClient, ledgerRequirement, resultsOf } from './payroll-test-client'

const NOVEMBER = 2

describe('payroll withholding link and labour cost report', () => {
  let ctx: HrTestContext
  let call: JsonCall
  let company: JsonCall
  let admin: string
  let agent: string

  beforeAll(async () => {
    ctx = await createHrTestContext()
    scheduleFilings(ctx.db, ctx.clock)
    call = jsonClient(ctx, `/api/company/${CORP}/payroll/bpo`)
    company = jsonClient(ctx, `/api/company/${CORP}`)
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
  })

  it('provides the ledger requirement once every card of the payment month is closed', async () => {
    expect(ledgerRequirement(ctx, CORP, '2026-10-payment')).toEqual({ response: 'provided', auto_linked: 1 })
    expect(ledgerRequirement(ctx, CORP, '2026-11-payment')).toEqual({ response: 'pending', auto_linked: 1 })
    expect(ledgerRequirement(ctx, CORP, '2026-12-payment')).toEqual({ response: 'pending', auto_linked: 1 })

    await call(admin, 'PUT', `/card/${NOVEMBER}`, { status: 'calculated' }, 1)
    await call(agent, 'POST', `/card/${NOVEMBER}/request-approval`, {}, 2)
    expect(ledgerRequirement(ctx, CORP, '2026-11-payment')?.response).toBe('pending')
    await call(admin, 'POST', `/card/${NOVEMBER}/approve`, {}, 3)
    expect(ledgerRequirement(ctx, CORP, '2026-11-payment')?.response).toBe('provided')
    await call(admin, 'POST', `/card/${NOVEMBER}/cancel-approval`, {}, 4)
    expect(ledgerRequirement(ctx, CORP, '2026-11-payment')?.response).toBe('pending')
  })

  it('locks the card once the withholding return is filed', async () => {
    const early = await call(admin, 'POST', '/card', { attribution_month: '2026-12', payment_date: '2026-11-30' })
    const earlyId = early.body['id'] as number
    await call(admin, 'POST', `/card/${earlyId}/business/payroll-input`, { rows: [{ name: '선지급', pay_amount: 500_000 }] })
    await call(admin, 'PUT', `/card/${earlyId}`, { status: 'calculated' }, 1)

    fileWithholding(ctx, CORP, '2026-11-payment')
    expect((await call(admin, 'POST', `/card/${NOVEMBER}/reject`, {}, 5)).body).toMatchObject({ code: 'WITHHOLDING_FILED', payment_month: '2026-11' })
    expect((await call(admin, 'POST', `/card/${NOVEMBER}/approve`, {}, 5)).body['status']).toBe('approved')
    expect((await call(admin, 'POST', `/card/${NOVEMBER}/cancel-approval`, {}, 6)).status).toBe(409)
    expect((await call(admin, 'POST', '/card', { attribution_month: '2026-11' })).body['code']).toBe('WITHHOLDING_FILED')
    expect((await call(agent, 'POST', `/card/${earlyId}/business/payroll-input/calculate`, {})).body['code']).toBe('WITHHOLDING_FILED')
    expect((await call(agent, 'PUT', `/card/${earlyId}`, { status: 'inputting' }, 2)).body['code']).toBe('WITHHOLDING_FILED')
    expect((await call(admin, 'POST', '/card', { attribution_month: '2026-12' })).body).toMatchObject({ code: 'WITHHOLDING_FILED' })
    const dates = resultsOf((await call(admin, 'GET', '/payment-date-list?attribution_month=2026-11')).body)
    expect(dates.map((entry) => [entry['payment_date'], entry['available']])).toEqual([
      ['2026-11-25', false],
      ['2026-12-25', true],
    ])
    expect((await call(admin, 'GET', `/card/${NOVEMBER}`)).body['withholding_filed']).toBe(true)
  })

  it('aggregates the withholding return of a payment month for agency staff', async () => {
    expect((await company(admin, 'GET', '/payroll/withholding-summary/2026-10')).status).toBe(403)
    const { body } = await company(agent, 'GET', '/payroll/withholding-summary/2026-10')
    expect(body).toMatchObject({ payment_month: '2026-10', ledger_closed: true, closed_card_ids: [1], verified: false })
    const a01 = (body['lines'] as Record<string, unknown>[]).find((line) => line['code'] === 'A01')
    expect(a01).toMatchObject({ headcount: 3, total_paid: 6_800_000, income_tax: 221_080 + 31_770, verified: false })
  })

  it('reports labour cost by attribution month with the employer insurance share', async () => {
    const { status, body } = await company(admin, 'GET', '/report/labor-cost/2026')
    expect(status).toBe(200)
    const monthly = body['monthly'] as Record<string, unknown>[]
    expect(monthly[9]).toMatchObject({
      month: 10,
      wage: 4_200_000 + 2_600_000,
      employer_insurance: Math.round(4_200_000 * 0.0115) + Math.round(2_600_000 * 0.0115),
      total_with_employer_insurance: 6_800_000 + 48_300 + 29_900,
    })
    expect(monthly[10]).toMatchObject({ month: 11, wage: expect.any(Number) })
    expect(body['totals']).toMatchObject({ wage: 6_800_000 + (monthly[10]?.['wage'] as number) })
    const csv = await ctx.call(admin, 'GET', `/api/company/${CORP}/report/labor-cost/2026/export`)
    expect(csv.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(await csv.text()).toContain('2026-10,6800000,0,0,0,6800000,78200,6878200')
  })
})
