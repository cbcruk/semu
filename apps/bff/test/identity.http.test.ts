import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessionKey } from '../src/sessions.ts'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD, makeHarness } from './legacy-client.ts'
import type { Harness, LegacyClient } from './legacy-client.ts'

let harness: Harness
let client: LegacyClient

beforeEach(() => {
  harness = makeHarness()
  client = harness.client()
})

afterEach(() => harness.dispose())

/** 지금 BFF 세션이 들고 있는 새 API access token입니다. */
async function storedAccessToken(): Promise<string | undefined> {
  const token = client.cookies.get('sessionid')
  return token === undefined ? undefined : (await harness.bff.store.get(sessionKey(token)))?.accessToken
}

describe('POST /api/login/', () => {
  it('signs in through the new API and answers with the legacy session cookies and body', async () => {
    const response = await client.login('owner@semu.example')

    expect(response.status).toBe(200)
    const cookies = response.headers.getSetCookie()
    expect(cookies.find((cookie) => cookie.startsWith('sessionid='))).toContain('HttpOnly')
    expect(cookies.some((cookie) => cookie.startsWith('nexus_csrftoken='))).toBe(true)
    expect(cookies.some((cookie) => cookie.startsWith('csrftoken='))).toBe(true)
    expect(cookies.some((cookie) => cookie.startsWith('semu_refresh='))).toBe(false)
    const body = await response.json()
    expect(body).toEqual({
      user: {
        id: 'usr_01JBQ000000000000000000001',
        email: 'owner@semu.example',
        name: expect.any(String),
        phone: null,
        user_type: 0,
        marketing_agreed: false,
        last_login_at: null,
      },
      csrf_token: client.cookies.get('csrftoken'),
      expires_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    })
    expect(JSON.stringify(body)).not.toContain('accessToken')
  })

  it('renders a wrong password as the legacy error body', async () => {
    const response = await client.login('owner@semu.example', 'wrong123')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: expect.any(String), code: 'INVALID_CREDENTIALS' })
    expect(client.cookies.has('sessionid')).toBe(false)
  })

  it('renders request validation as 422 with snake_case field errors', async () => {
    const response = await client.request('POST', '/api/login/', {
      body: { email: 'owner@semu.example', stay_signed_in: 'yes' },
    })

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toMatchObject({ detail: 'Request validation failed.', code: 'VALIDATION_FAILED' })
    expect(Object.keys(body.errors).sort()).toEqual(['password', 'stay_signed_in'])
    expect(body.errors.password).toEqual(['This field is required.'])
  })
})

describe('GET /api/user/me/', () => {
  it('needs the session cookie', async () => {
    const response = await client.request('GET', '/api/user/me/')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      detail: 'Authentication credentials were not provided or are invalid.',
      code: 'UNAUTHENTICATED',
    })
  })

  it('returns the profile with the switchable companies in the legacy shape', async () => {
    await client.login('owner@semu.example')

    const response = await client.request('GET', '/api/user/me/')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ email: 'owner@semu.example', user_type: 0 })
    expect(body.companies).toEqual([
      {
        id: DEMO_COMPANY_IDS.corporation,
        sf_company_id: DEMO_COMPANY_IDS.corporation,
        name: expect.any(String),
        tax_plan: 'taxation',
        is_system_admin: true,
      },
      {
        id: DEMO_COMPANY_IDS.free,
        sf_company_id: DEMO_COMPANY_IDS.free,
        name: expect.any(String),
        tax_plan: null,
        is_system_admin: false,
      },
    ])
  })

  it('serves the profile alone at GET /api/member/profile/', async () => {
    await client.login('member@semu.example')

    const response = await client.request('GET', '/api/member/profile/')

    expect(await response.json()).toMatchObject({ email: 'member@semu.example', user_type: 0 })
  })

  it('refreshes an expired access token before calling the new API', async () => {
    await client.login('owner@semu.example')
    const before = await storedAccessToken()

    harness.advance(11 * 60 * 1000)
    const response = await client.request('GET', '/api/user/me/')

    expect(response.status).toBe(200)
    const after = await storedAccessToken()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })

  it('ends the legacy session when the new API revoked it', async () => {
    await client.login('owner@semu.example')
    const direct = await harness.api.signIn('owner@semu.example')
    const changed = await harness.api.request('POST', '/v1/me/password:change', {
      token: direct.token,
      body: { currentPassword: DEMO_PASSWORD, newPassword: 'changed123' },
    })
    expect(changed.status).toBe(204)

    const response = await client.request('GET', '/api/user/me/')

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(client.cookies.has('sessionid')).toBe(false)
  })
})

describe('POST /api/logout/', () => {
  it('rejects a write without the CSRF header', async () => {
    await client.login('owner@semu.example')

    const response = await client.request('POST', '/api/logout/', { csrf: false })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'CSRF token missing or incorrect.', code: 'CSRF_FAILED' })
  })

  it('ends the new API session and clears the cookies', async () => {
    await client.login('owner@semu.example')

    const response = await client.request('POST', '/api/logout/')

    expect(response.status).toBe(204)
    expect(client.cookies.size).toBe(0)
    const after = await client.request('GET', '/api/user/me/')
    expect(after.status).toBe(401)
  })
})

describe('company switching', () => {
  it('rebinds the session to the company in the path and back', async () => {
    await client.login('owner@semu.example')

    const free = await client.request('GET', `/api/company/${DEMO_COMPANY_IDS.free}/`)
    const corporation = await client.request('GET', `/api/settings/company/${DEMO_COMPANY_IDS.corporation}/`)

    expect(free.status).toBe(200)
    expect(await free.json()).toMatchObject({
      id: DEMO_COMPANY_IDS.free,
      sf_company_id: DEMO_COMPANY_IDS.free,
      business_type: 'individual',
      kind: 1,
      tax_plan: null,
      has_payroll_plan: false,
    })
    expect(corporation.status).toBe(200)
    expect(corporation.headers.get('etag')).toMatch(/^"\d+"$/)
    expect(await corporation.json()).toMatchObject({
      id: DEMO_COMPANY_IDS.corporation,
      business_type: 'corporate',
      kind: 0,
      tax_plan: 'taxation',
      has_payroll_plan: true,
      representatives: [{ id: null, role: 'boss', name: expect.any(String), phone: null }],
    })
  })

  it('serializes concurrent switches so the new API never sees a reused refresh token', async () => {
    await client.login('owner@semu.example')

    const responses = await Promise.all(
      [DEMO_COMPANY_IDS.free, DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.free, DEMO_COMPANY_IDS.corporation].map(
        (companyId) => client.request('GET', `/api/company/${companyId}/`),
      ),
    )

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200])
    expect((await client.request('GET', '/api/user/me/')).status).toBe(200)
  })

  it('hands out a company-bound token at POST /api/user/me/jwt/ that the new API accepts', async () => {
    await client.login('owner@semu.example')

    const response = await client.request('POST', '/api/user/me/jwt/', {
      body: { company_id: DEMO_COMPANY_IDS.free },
    })

    expect(response.status).toBe(200)
    const { token } = await response.json()
    const me = await harness.api.request('GET', '/v1/me', { token })
    expect(await me.json()).toMatchObject({ company: { id: DEMO_COMPANY_IDS.free } })
  })

  it('answers a company the user cannot access with the legacy 404', async () => {
    await client.login('owner@semu.example')

    const response = await client.request('GET', `/api/company/${DEMO_COMPANY_IDS.individual}/`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: expect.any(String), code: 'NOT_FOUND' })
    const stillCorporation = await client.request('GET', '/api/user/me/')
    expect(stillCorporation.status).toBe(200)
  })
})

describe('unknown legacy routes', () => {
  it('answer the legacy 404 body', async () => {
    const response = await client.request('GET', '/api/company/x/payroll/cards/')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'Not found.', code: 'NOT_FOUND' })
  })
})
