import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD } from '../demo-seed.ts'
import { cookieOf, makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('POST /v1/auth/sessions', () => {
  it('signs in, sets an HttpOnly refresh cookie and binds the last-used or first company', async () => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'OWNER@semu.example', password: DEMO_PASSWORD },
    })

    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^semu_refresh=ses_[0-9A-Z]{26}\./)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/v1/auth')
    const body = await response.json()
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 600,
      user: { email: 'owner@semu.example', kind: 'CLIENT', isDemo: false },
      company: { id: DEMO_COMPANY_IDS.corporation, actorKind: 'CLIENT', plans: ['TAXATION', 'PAYROLL'] },
    })
    expect(body.companies.map((c: { id: string }) => c.id)).toEqual([
      DEMO_COMPANY_IDS.corporation,
      DEMO_COMPANY_IDS.free,
    ])
    expect(body).not.toHaveProperty('refreshToken')
  })

  it('answers the same 401 for an unknown email and a wrong password', async () => {
    const unknown = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'nobody@x.example', password: 'abc12345' },
    })
    const wrong = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'owner@semu.example', password: 'wrong123' },
    })

    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it('locks the account after five wrong passwords, even for the right one', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await app.request('POST', '/v1/auth/sessions', {
        body: { email: 'member@semu.example', password: 'nope1234' },
      })
      expect(response.status).toBe(401)
    }
    const fifth = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'member@semu.example', password: 'nope1234' },
    })
    const right = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'member@semu.example', password: DEMO_PASSWORD },
    })

    expect(fifth.status).toBe(423)
    expect(await right.json()).toMatchObject({ code: 'ACCOUNT_LOCKED' })
  })

  it('refuses a company the user cannot access without revealing whether it exists', async () => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'owner@semu.example', password: DEMO_PASSWORD, companyId: DEMO_COMPANY_IDS.individual },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'COMPANY_NOT_FOUND' })
  })
})

describe('GET /v1/me', () => {
  it('returns the computed permissions, plans and switch targets of an admin', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('GET', '/v1/me', { token })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      company: { id: DEMO_COMPANY_IDS.corporation, actorKind: 'CLIENT', plans: ['TAXATION', 'PAYROLL'] },
      membership: { access: 'ADMIN', isOwner: true },
      permissions: ['*'],
      promotions: [],
      pendingTermCodes: [],
    })
  })

  it('gives a member the base permissions plus the union of their roles', async () => {
    const { token } = await app.signIn('member@semu.example')

    const body = await (await app.request('GET', '/v1/me', { token })).json()

    expect(body.membership).toMatchObject({ access: 'MEMBER', isOwner: false })
    expect(body.permissions).toEqual(expect.arrayContaining(['company:read', 'evidence:*', 'bank-transaction:*']))
    expect(body.permissions).not.toContain('member:update')
  })

  it('treats assigned agency staff as AGENCY with every permission, including the team of a manager', async () => {
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const manager = await app.signIn('manager@agency.example')

    expect(agent.body).toMatchObject({ company: { id: DEMO_COMPANY_IDS.individual, actorKind: 'AGENCY' } })
    const me = await (await app.request('GET', '/v1/me', { token: manager.token })).json()
    expect(me.permissions).toEqual(['*'])
    expect(me).not.toHaveProperty('membership')
    expect(me.companies.map((c: { id: string }) => c.id).sort()).toEqual(
      [DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.individual].sort(),
    )
  })

  it('lists pending tax terms for a taxation customer who has not agreed yet', async () => {
    const { token } = await app.signIn('sole@semu.example')

    expect(await (await app.request('GET', '/v1/me', { token })).json()).toMatchObject({
      pendingTermCodes: ['TAX_SERVICE'],
    })
  })

  it('promotes every plan to a free company', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    expect(await (await app.request('GET', '/v1/me', { token })).json()).toMatchObject({
      company: { plans: [] },
      promotions: ['TAXATION', 'PAYROLL'],
    })
  })

  it('answers 401 without a token', async () => {
    expect((await app.request('GET', '/v1/me')).status).toBe(401)
  })
})

describe('refresh, switch and sign-out', () => {
  it('rotates the refresh token and revokes the previous access token', async () => {
    const first = await app.signIn('owner@semu.example')

    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })

    expect(refreshed.status).toBe(200)
    const body = await refreshed.json()
    expect(cookieOf(refreshed)).not.toBe(first.cookie)
    expect((await app.request('GET', '/v1/me', { token: first.token })).status).toBe(401)
    expect((await app.request('GET', '/v1/me', { token: body.accessToken })).status).toBe(200)
  })

  it('revokes the whole session when a rotated refresh token comes back', async () => {
    const first = await app.signIn('owner@semu.example')
    const rotated = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })
    const latest = cookieOf(rotated)

    const replay = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })
    const afterReplay = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: latest })

    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ code: 'SESSION_INVALID' })
    expect(afterReplay.status).toBe(401)
  })

  it('switches company with a new token bound to the new company', async () => {
    const first = await app.signIn('owner@semu.example')

    const switched = await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: DEMO_COMPANY_IDS.free },
    })

    expect(switched.status).toBe(200)
    const { accessToken } = await switched.json()
    expect(await (await app.request('GET', '/v1/me', { token: accessToken })).json()).toMatchObject({
      company: { id: DEMO_COMPANY_IDS.free },
    })
    expect((await app.request('GET', '/v1/me', { token: first.token })).status).toBe(401)
  })

  it('remembers the last company for the next sign-in', async () => {
    const first = await app.signIn('owner@semu.example')
    await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: DEMO_COMPANY_IDS.free },
    })

    const again = await app.signIn('owner@semu.example')

    expect(again.body).toMatchObject({ company: { id: DEMO_COMPANY_IDS.free } })
  })

  it('refuses to switch to a company outside the user', async () => {
    const first = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: DEMO_COMPANY_IDS.individual },
    })

    expect(response.status).toBe(404)
  })

  it('signs out, clears the cookie and kills both tokens', async () => {
    const first = await app.signIn('owner@semu.example')

    const response = await app.request('DELETE', '/v1/auth/sessions/current', { cookie: first.cookie })

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await app.request('GET', '/v1/me', { token: first.token })).status).toBe(401)
    expect((await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })).status).toBe(401)
  })

  it('answers 401 for a refresh without a cookie', async () => {
    expect((await app.request('POST', '/v1/auth/sessions:refresh')).status).toBe(401)
  })
})

describe('demo', () => {
  it('signs in the read-only demo account without a password', async () => {
    const response = await app.request('POST', '/v1/auth/sessions:demo')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ user: { isDemo: true }, company: { id: DEMO_COMPANY_IDS.demo } })
  })

  it('does not let anyone sign in to the demo account with a password', async () => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'demo@semu.example', password: DEMO_PASSWORD },
    })

    expect(response.status).toBe(401)
  })
})
