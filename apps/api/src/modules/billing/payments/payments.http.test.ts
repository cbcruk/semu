import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'
import { DEMO_PAYMENT_IDS } from '../billing-seed.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('GET /v1/payments', () => {
  it('lists payroll outsourcing payments newest first with a masked account', async () => {
    const { token } = await app.signIn('owner@alfred.example')

    const response = await app.request('GET', '/v1/payments', { token })

    expect(response.status).toBe(200)
    const { items } = await response.json()
    expect(items.map((item: { number: number }) => item.number)).toEqual([1006, 1004, 1002, 1001])
    expect(items[0]).toMatchObject({
      plan: 'PAYROLL',
      status: 'SCHEDULED',
      scheduledOn: '2026-11-25',
      resultExpectedOn: '2026-11-26',
      account: { bankCode: '088', accountNumberMasked: '*********4321' },
      allowedActions: [],
    })
    expect(JSON.stringify(items)).not.toContain('TAXATION')
  })

  it('pages with a cursor and filters by status', async () => {
    const { token } = await app.signIn('owner@alfred.example')

    const first = await (await app.request('GET', '/v1/payments?limit=2', { token })).json()
    const second = await (await app.request('GET', `/v1/payments?limit=2&cursor=${first.nextCursor}`, { token })).json()
    const failed = await (await app.request('GET', '/v1/payments?status=FAILED', { token })).json()

    expect(first.items.map((item: { number: number }) => item.number)).toEqual([1006, 1004])
    expect(second.items.map((item: { number: number }) => item.number)).toEqual([1002, 1001])
    expect(second).not.toHaveProperty('nextCursor')
    expect(failed.items).toEqual([expect.objectContaining({ failureReason: 'INSUFFICIENT_BALANCE' })])
  })

  it('hides a payment of a product not shown in the list', async () => {
    const { token } = await app.signIn('owner@alfred.example')

    expect((await app.request('GET', `/v1/payments/${DEMO_PAYMENT_IDS.tax}`, { token })).status).toBe(404)
  })

  it('needs payment:read', async () => {
    const { token } = await app.signIn('member@alfred.example')

    const response = await app.request('GET', '/v1/payments', { token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'payment:read' })
  })
})

describe('agency payment commands', () => {
  it('retries a failed payment on the next business day', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })

    const response = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.failed}:retry`, {
      token,
      headers: { 'idempotency-key': 'retry-1' },
      body: { retryOn: '2099-01-03' },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ status: 'RETRYING', scheduledOn: '2099-01-05', resultExpectedOn: '2099-01-06' })
    expect(body).not.toHaveProperty('failureReason')
  })

  it('requires an idempotency key and rejects retrying a scheduled payment', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })

    const missingKey = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.failed}:retry`, { token, body: {} })
    const scheduled = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.scheduled}:retry`, {
      token,
      headers: { 'idempotency-key': 'retry-2' },
      body: {},
    })

    expect(missingKey.status).toBe(428)
    expect(scheduled.status).toBe(409)
    expect(await scheduled.json()).toMatchObject({ code: 'PAYMENT_TRANSITION_INVALID', currentStatus: 'SCHEDULED' })
  })

  it('refunds a paid payment', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })

    const response = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.paid}:refund`, {
      token,
      headers: { 'idempotency-key': 'refund-1' },
    })

    expect(await response.json()).toMatchObject({ status: 'REFUNDED', refundedAt: expect.any(String) })
  })

  it('does not let a client admin retry', async () => {
    const { token } = await app.signIn('owner@alfred.example')

    const response = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.failed}:retry`, {
      token,
      headers: { 'idempotency-key': 'retry-3' },
      body: {},
    })

    expect(response.status).toBe(403)
  })
})
