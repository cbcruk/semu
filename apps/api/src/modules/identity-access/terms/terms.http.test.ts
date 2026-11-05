import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, demoTerms } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

interface Agreement {
  term: { id: string; code: string; required: boolean }
  status: string
}

describe('terms', () => {
  it('lists the current signup terms before sign-in', async () => {
    const response = await app.request('GET', '/v1/terms?purpose=SIGNUP')

    expect(response.status).toBe(200)
    const { items } = await response.json()
    expect(items.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(['SERVICE', 'PRIVACY']))
  })

  it('shows tax terms only to a taxation company and clears the gate after agreeing', async () => {
    const sole = await app.signIn('sole@alfred.example')
    const { items } = await (await app.request('GET', '/v1/me/term-agreements', { token: sole.token })).json()
    const taxTerm = (items as Agreement[]).find((a) => a.term.code === 'TAX_SERVICE')
    expect(taxTerm).toMatchObject({ status: 'REQUIRED' })

    const decided = await app.request('POST', '/v1/me/term-agreements', {
      token: sole.token,
      body: { decisions: [{ termId: taxTerm?.term.id, agreed: true }] },
    })

    expect(decided.status).toBe(200)
    expect((await app.request('GET', '/v1/me', { token: sole.token })).status).toBe(401)
    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: sole.cookie })
    const me = await (await app.request('GET', '/v1/me', { token: (await refreshed.json()).accessToken })).json()
    expect(me.pendingTermCodes).toEqual([])
  })

  it('refuses to record a declined required term', async () => {
    const sole = await app.signIn('sole@alfred.example')
    const { items } = await (await app.request('GET', '/v1/me/term-agreements', { token: sole.token })).json()
    const taxTerm = (items as Agreement[]).find((a) => a.term.code === 'TAX_SERVICE')

    const response = await app.request('POST', '/v1/me/term-agreements', {
      token: sole.token,
      body: { decisions: [{ termId: taxTerm?.term.id, agreed: false }] },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'REQUIRED_TERM_DECLINED' })
  })

  it('refuses an answer to an outdated term version', async () => {
    const owner = await app.signIn('owner@alfred.example')
    const outdatedId = demoTerms().find((t) => t.code === 'SERVICE' && t.version === '2025-07')?.id

    const response = await app.request('POST', '/v1/me/term-agreements', {
      token: owner.token,
      body: { decisions: [{ termId: outdatedId, agreed: true }] },
    })

    expect(response.status).toBe(409)
  })

  it('does not show tax terms to a free company', async () => {
    const owner = await app.signIn('owner@alfred.example', { companyId: DEMO_COMPANY_IDS.free })
    const { items } = await (await app.request('GET', '/v1/me/term-agreements', { token: owner.token })).json()

    expect((items as Agreement[]).map((a) => a.term.code)).not.toContain('TAX_SERVICE')
  })
})
