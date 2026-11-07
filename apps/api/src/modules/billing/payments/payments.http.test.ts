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

describe('결제 내역(GET /v1/payments)', () => {
  it('급여 아웃소싱 결제를 최신순으로 계좌번호를 가려 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

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

  it('커서로 페이지를 나누고 상태로 거릅니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const first = await (await app.request('GET', '/v1/payments?limit=2', { token })).json()
    const second = await (await app.request('GET', `/v1/payments?limit=2&cursor=${first.nextCursor}`, { token })).json()
    const failed = await (await app.request('GET', '/v1/payments?status=FAILED', { token })).json()

    expect(first.items.map((item: { number: number }) => item.number)).toEqual([1006, 1004])
    expect(second.items.map((item: { number: number }) => item.number)).toEqual([1002, 1001])
    expect(second).not.toHaveProperty('nextCursor')
    expect(failed.items).toEqual([expect.objectContaining({ failureReason: 'INSUFFICIENT_BALANCE' })])
  })

  it('결제 내역에 보여 주지 않는 상품의 결제는 숨깁니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    expect((await app.request('GET', `/v1/payments/${DEMO_PAYMENT_IDS.tax}`, { token })).status).toBe(404)
  })

  it('payment:read 권한이 있어야 합니다', async () => {
    const { token } = await app.signIn('member@semu.example')

    const response = await app.request('GET', '/v1/payments', { token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'payment:read' })
  })
})

describe('담당자의 결제 커맨드', () => {
  it('실패한 결제를 다음 영업일에 재시도합니다', async () => {
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

  it('멱등 키를 요구하고 예정 결제의 재시도는 거부합니다', async () => {
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

  it('완료된 결제를 환불합니다', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })

    const response = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.paid}:refund`, {
      token,
      headers: { 'idempotency-key': 'refund-1' },
    })

    expect(await response.json()).toMatchObject({ status: 'REFUNDED', refundedAt: expect.any(String) })
  })

  it('고객사 관리자는 재시도할 수 없습니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', `/v1/payments/${DEMO_PAYMENT_IDS.failed}:retry`, {
      token,
      headers: { 'idempotency-key': 'retry-3' },
      body: {},
    })

    expect(response.status).toBe(403)
  })
})
