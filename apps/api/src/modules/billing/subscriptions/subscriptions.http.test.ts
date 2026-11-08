import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { DEMO_SERVICE_CONTRACT_IDS } from '../billing-seed.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('구독 목록(GET /v1/subscriptions)', () => {
  it('고객에게는 이용 가능한 구독을 담당자 커맨드 없이 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('GET', '/v1/subscriptions', { token })

    expect(response.status).toBe(200)
    const { items } = await response.json()
    expect(items.map((item: { plan: string }) => item.plan)).toEqual(['TAXATION', 'PAYROLL'])
    expect(items[0]).toMatchObject({ status: 'ACTIVE', isEntitled: true, allowedActions: [] })
  })

  it('무료 고객의 종료된 구독은 이용 불가로 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const { items } = await (await app.request('GET', '/v1/subscriptions', { token })).json()

    expect(items).toEqual([expect.objectContaining({ plan: 'PAYROLL', status: 'ENDED', isEntitled: false })])
  })

  it('담당자에게는 상태가 허용하는 커맨드를 보여 줍니다', async () => {
    const { token } = await app.signIn('agent@agency.example')

    const { items } = await (await app.request('GET', '/v1/subscriptions', { token })).json()

    expect(items[0].allowedActions).toEqual(['CANCEL'])
  })
})

describe('담당자의 구독 커맨드', () => {
  it('고객사 관리자는 모든 권한이 있어도 거절합니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('POST', '/v1/subscriptions', {
      token,
      body: { plan: 'PAYROLL', startsOn: '2026-12-01', monthlyFee: 330000 },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'subscription:manage' })
  })

  it('미래에 시작하는 구독은 대기로 만들고 같은 플랜의 두 번째 구독은 거절합니다', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })

    const started = await app.request('POST', '/v1/subscriptions', {
      token,
      body: { plan: 'PAYROLL', startsOn: '2099-01-01', monthlyFee: 330000 },
    })
    const again = await app.request('POST', '/v1/subscriptions', {
      token,
      body: { plan: 'PAYROLL', startsOn: '2099-02-01', monthlyFee: 330000 },
    })

    expect(started.status).toBe(201)
    expect(await started.json()).toMatchObject({ status: 'PENDING', isEntitled: false, allowedActions: ['CANCEL'] })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'SUBSCRIPTION_ALREADY_EXISTS' })
  })

  it('다른 회사의 서비스 계약은 거절합니다', async () => {
    const { token } = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const start = (serviceContractId: string) =>
      app.request('POST', '/v1/subscriptions', {
        token,
        body: { plan: 'PAYROLL', startsOn: '2099-01-01', monthlyFee: 330000, serviceContractId },
      })

    const foreign = await start(DEMO_SERVICE_CONTRACT_IDS.corporationBookkeeping)
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toMatchObject({ code: 'SERVICE_CONTRACT_NOT_FOUND' })

    const own = await start(DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping)
    expect(own.status).toBe(201)
    expect(await own.json()).toMatchObject({ serviceContractId: DEMO_SERVICE_CONTRACT_IDS.individualBookkeeping })
  })

  it('해지를 예약하면 종료일까지 플랜을 유지하고 예약을 거둘 수 있습니다', async () => {
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const { items } = await (await app.request('GET', '/v1/subscriptions', { token: agent.token })).json()
    const id = items[0].id

    const canceled = await app.request('POST', `/v1/subscriptions/${id}:cancel`, {
      token: agent.token,
      headers: { 'if-match': '"1"' },
      body: { endsOn: '2099-12-31' },
    })

    expect(canceled.status).toBe(200)
    expect(canceled.headers.get('etag')).toBe('"2"')
    expect(await canceled.json()).toMatchObject({
      status: 'CANCELLATION_SCHEDULED',
      isEntitled: true,
      endsOn: '2099-12-31',
      allowedActions: ['RESUME'],
    })
    const sole = await app.signIn('sole@semu.example')
    expect((await (await app.request('GET', '/v1/me', { token: sole.token })).json()).company.plans).toEqual([
      'TAXATION',
    ])

    const stale = await app.request('POST', `/v1/subscriptions/${id}:resume`, {
      token: agent.token,
      headers: { 'if-match': '"1"' },
    })
    const resumed = await app.request('POST', `/v1/subscriptions/${id}:resume`, { token: agent.token })

    expect(stale.status).toBe(412)
    expect(await resumed.json()).toMatchObject({ status: 'ACTIVE', allowedActions: ['CANCEL'] })
  })

  it('지난 날짜를 종료일로 받지 않습니다', async () => {
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const { items } = await (await app.request('GET', '/v1/subscriptions', { token: agent.token })).json()

    const response = await app.request('POST', `/v1/subscriptions/${items[0].id}:cancel`, {
      token: agent.token,
      body: { endsOn: '2020-01-01' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_END_DATE_INVALID' })
  })

  it('해지 예약이 없는 구독은 해지 철회를 거절합니다', async () => {
    const agent = await app.signIn('agent@agency.example')
    const { items } = await (await app.request('GET', '/v1/subscriptions', { token: agent.token })).json()

    const response = await app.request('POST', `/v1/subscriptions/${items[0].id}:resume`, { token: agent.token })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_TRANSITION_INVALID', currentStatus: 'ACTIVE' })
  })
})
