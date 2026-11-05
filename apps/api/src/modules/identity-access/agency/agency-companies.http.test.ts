import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_USER_IDS } from '../demo-seed.ts'
import { cookieOf, makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

/** 로그인한 뒤 대리인 범위로 전환하고 그 토큰과 refresh 쿠키를 돌려줍니다. */
async function agencySession(email: string): Promise<{ token: string; cookie: string; body: any }> {
  const { cookie } = await app.signIn(email)
  const response = await app.request('POST', '/v1/auth/sessions:switch-agency', { cookie })
  if (response.status !== 200) throw new Error(`switch-agency failed: ${response.status} ${await response.text()}`)
  const body = await response.json()
  return { token: body.accessToken, cookie: cookieOf(response), body }
}

describe('POST /v1/auth/sessions:switch-agency', () => {
  it('gives agency staff an agency-scoped token that is bound to no company', async () => {
    const { body } = await agencySession('agent@agency.example')

    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 600, scope: 'AGENCY', user: { kind: 'AGENCY_STAFF' } })
    expect(body).not.toHaveProperty('company')
    expect(body.companies.map((c: { id: string }) => c.id).sort()).toEqual(
      [DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.individual].sort(),
    )
  })

  it('refuses a customer user with 403 and leaves the session usable', async () => {
    const { cookie } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/auth/sessions:switch-agency', { cookie })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'AGENCY_SCOPE_NOT_ALLOWED' })
    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie })
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toMatchObject({ scope: 'COMPANY' })
  })

  it('keeps the agency scope across refresh until the agent switches to a company', async () => {
    const agency = await agencySession('agent@agency.example')

    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: agency.cookie })
    const refreshedBody = await refreshed.json()
    expect(refreshedBody).toMatchObject({ scope: 'AGENCY' })
    expect(refreshedBody).not.toHaveProperty('company')
    const oldToken = await app.request('GET', '/v1/agency/companies', { token: agency.token })
    expect(oldToken.status).toBe(401)

    const switched = await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: cookieOf(refreshed),
      body: { companyId: DEMO_COMPANY_IDS.individual },
    })
    const switchedBody = await switched.json()
    expect(switchedBody).toMatchObject({
      scope: 'COMPANY',
      company: { id: DEMO_COMPANY_IDS.individual, actorKind: 'AGENCY' },
    })
    const me = await app.request('GET', '/v1/me', { token: switchedBody.accessToken })
    expect(me.status).toBe(200)
    const agencyAfterSwitch = await app.request('GET', '/v1/agency/companies', { token: refreshedBody.accessToken })
    expect(agencyAfterSwitch.status).toBe(401)
  })
})

describe('token scope', () => {
  it('rejects an agency token on company resources with 403 TOKEN_SCOPE_MISMATCH', async () => {
    const { token } = await agencySession('agent@agency.example')

    for (const path of ['/v1/me', '/v1/companies/current', '/v1/filings', '/v1/action-cards']) {
      const response = await app.request('GET', path, { token })
      expect(response.status, path).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'COMPANY' })
    }
  })

  it('rejects company tokens on /agency/* with 403, for customers and for agents inside a company', async () => {
    const owner = await app.signIn('owner@semu.example')
    const agentInCompany = await app.signIn('agent@agency.example')

    for (const token of [owner.token, agentInCompany.token]) {
      const response = await app.request('GET', '/v1/agency/companies', { token })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'AGENCY' })
    }
  })

  it('answers 401 without a token', async () => {
    const response = await app.request('GET', '/v1/agency/companies')

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('GET /v1/agency/companies', () => {
  it('lists only the assigned companies by name, with tax workload counted by Tax', async () => {
    const { token } = await agencySession('agent@agency.example')

    const response = await app.request('GET', '/v1/agency/companies', { token })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toEqual([
      {
        id: DEMO_COMPANY_IDS.individual,
        name: '세무 상점',
        businessType: 'INDIVIDUAL',
        plans: ['TAXATION'],
        assigneeIds: [DEMO_USER_IDS.agent],
        workload: expect.objectContaining({ openFilingCount: 1, openActionCardCount: 0, nearestDueDate: '2026-11-10' }),
      },
      {
        id: DEMO_COMPANY_IDS.corporation,
        name: '주식회사 세무',
        businessType: 'CORPORATION',
        plans: ['TAXATION', 'PAYROLL'],
        assigneeIds: [DEMO_USER_IDS.agent],
        workload: expect.objectContaining({ openFilingCount: 2, openActionCardCount: 0, nearestDueDate: '2026-11-10' }),
      },
    ])
    expect(body.items.map((c: { id: string }) => c.id)).not.toContain(DEMO_COMPANY_IDS.demo)
  })

  it('shows a manager the companies of the team and filters by assignee', async () => {
    const { token } = await agencySession('manager@agency.example')

    const all = await (await app.request('GET', '/v1/agency/companies', { token })).json()
    const mine = await (
      await app.request('GET', `/v1/agency/companies?assigneeId=${DEMO_USER_IDS.manager}`, { token })
    ).json()

    expect(all.items).toHaveLength(2)
    expect(all.items.every((c: { assigneeIds: string[] }) => c.assigneeIds.includes(DEMO_USER_IDS.agent))).toBe(true)
    expect(mine.items).toEqual([])
  })

  it('pages with a cursor', async () => {
    const { token } = await agencySession('agent@agency.example')

    const first = await (await app.request('GET', '/v1/agency/companies?limit=1', { token })).json()
    const second = await (
      await app.request('GET', `/v1/agency/companies?limit=1&cursor=${first.nextCursor}`, { token })
    ).json()

    expect(first.items.map((c: { id: string }) => c.id)).toEqual([DEMO_COMPANY_IDS.individual])
    expect(second.items.map((c: { id: string }) => c.id)).toEqual([DEMO_COMPANY_IDS.corporation])
    expect(second).not.toHaveProperty('nextCursor')
  })
})
