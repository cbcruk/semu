import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('GET /v1/subscriptions', () => {
  it('lists entitled subscriptions without agency commands for a client', async () => {
    const { token } = await app.signIn('owner@alfred.example')

    const response = await app.request('GET', '/v1/subscriptions', { token })

    expect(response.status).toBe(200)
    const { items } = await response.json()
    expect(items.map((item: { plan: string }) => item.plan)).toEqual(['TAXATION', 'PAYROLL'])
    expect(items[0]).toMatchObject({ status: 'ACTIVE', isEntitled: true, allowedActions: [] })
  })

  it('shows an ended subscription of a free company as not entitled', async () => {
    const { token } = await app.signIn('owner@alfred.example', { companyId: DEMO_COMPANY_IDS.free })

    const { items } = await (await app.request('GET', '/v1/subscriptions', { token })).json()

    expect(items).toEqual([expect.objectContaining({ plan: 'PAYROLL', status: 'ENDED', isEntitled: false })])
  })

  it('offers the agency the commands the status allows', async () => {
    const { token } = await app.signIn('agent@agency.example')

    const { items } = await (await app.request('GET', '/v1/subscriptions', { token })).json()

    expect(items[0].allowedActions).toEqual(['CANCEL'])
  })
})

describe('agency subscription commands', () => {
  it('refuses a client admin even though the admin holds every permission', async () => {
    const { token } = await app.signIn('owner@alfred.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('POST', '/v1/subscriptions', {
      token,
      body: { plan: 'PAYROLL', startsOn: '2026-12-01', monthlyFee: 330000 },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'subscription:manage' })
  })

  it('starts a future subscription as pending and rejects a second one for the same plan', async () => {
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

  it('schedules a cancellation, keeps the plan until the end date and resumes it', async () => {
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
    const sole = await app.signIn('sole@alfred.example')
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

  it('rejects an end date in the past', async () => {
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const { items } = await (await app.request('GET', '/v1/subscriptions', { token: agent.token })).json()

    const response = await app.request('POST', `/v1/subscriptions/${items[0].id}:cancel`, {
      token: agent.token,
      body: { endsOn: '2020-01-01' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_END_DATE_INVALID' })
  })

  it('rejects resuming a subscription that is not scheduled to end', async () => {
    const agent = await app.signIn('agent@agency.example')
    const { items } = await (await app.request('GET', '/v1/subscriptions', { token: agent.token })).json()

    const response = await app.request('POST', `/v1/subscriptions/${items[0].id}:resume`, { token: agent.token })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_TRANSITION_INVALID', currentStatus: 'ACTIVE' })
  })
})
