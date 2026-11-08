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

describe('대리인 범위로 전환(POST /v1/auth/sessions:switch-agency)', () => {
  it('세무 대리인 담당자에게 어느 회사에도 묶이지 않은 대리인 범위 토큰을 줍니다', async () => {
    const { body } = await agencySession('agent@agency.example')

    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 600, scope: 'AGENCY', user: { kind: 'AGENCY_STAFF' } })
    expect(body).not.toHaveProperty('company')
    expect(body.companies.map((c: { id: string }) => c.id).sort()).toEqual(
      [DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.individual].sort(),
    )
  })

  it('고객사 사용자는 403으로 거절하고 세션은 그대로 쓸 수 있게 둡니다', async () => {
    const { cookie } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/auth/sessions:switch-agency', { cookie })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'AGENCY_SCOPE_NOT_ALLOWED' })
    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie })
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toMatchObject({ scope: 'COMPANY' })
  })

  it('대리인이 회사로 전환하기 전까지는 토큰을 갱신해도 대리인 범위를 유지합니다', async () => {
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

describe('토큰 범위', () => {
  it('회사 리소스에 대리인 범위 토큰을 쓰면 403 TOKEN_SCOPE_MISMATCH로 거절합니다', async () => {
    const { token } = await agencySession('agent@agency.example')

    for (const path of ['/v1/me', '/v1/companies/current', '/v1/filings', '/v1/action-cards']) {
      const response = await app.request('GET', path, { token })
      expect(response.status, path).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'COMPANY' })
    }
  })

  it('/agency/*에 회사 범위 토큰을 쓰면 고객이든 회사 안의 대리인이든 403으로 거절합니다', async () => {
    const owner = await app.signIn('owner@semu.example')
    const agentInCompany = await app.signIn('agent@agency.example')

    for (const token of [owner.token, agentInCompany.token]) {
      const response = await app.request('GET', '/v1/agency/companies', { token })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'AGENCY' })
    }
  })

  it('토큰이 없으면 401로 답합니다', async () => {
    const response = await app.request('GET', '/v1/agency/companies')

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('대리인 담당 회사 목록(GET /v1/agency/companies)', () => {
  it('배정된 회사만 이름순으로 보여 주고 세무 일감 개수는 Tax가 셉니다', async () => {
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

  it('팀장에게는 팀의 담당 회사를 보여 주고 담당자로 거를 수 있습니다', async () => {
    const { token } = await agencySession('manager@agency.example')

    const all = await (await app.request('GET', '/v1/agency/companies', { token })).json()
    const mine = await (
      await app.request('GET', `/v1/agency/companies?assigneeId=${DEMO_USER_IDS.manager}`, { token })
    ).json()

    expect(all.items).toHaveLength(2)
    expect(all.items.every((c: { assigneeIds: string[] }) => c.assigneeIds.includes(DEMO_USER_IDS.agent))).toBe(true)
    expect(mine.items).toEqual([])
  })

  it('커서로 페이지를 나눕니다', async () => {
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
