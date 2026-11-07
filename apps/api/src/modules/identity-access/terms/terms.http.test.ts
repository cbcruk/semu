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

describe('약관', () => {
  it('로그인 전에 현재 가입 약관을 보여 줍니다', async () => {
    const response = await app.request('GET', '/v1/terms?purpose=SIGNUP')

    expect(response.status).toBe(200)
    const { items } = await response.json()
    expect(items.map((t: { code: string }) => t.code)).toEqual(expect.arrayContaining(['SERVICE', 'PRIVACY']))
  })

  it('세무 약관은 세무 기장 회사에만 보여 주고 동의하면 약관 게이트를 풉니다', async () => {
    const sole = await app.signIn('sole@semu.example')
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

  it('필수 약관을 거절한 답은 기록하지 않습니다', async () => {
    const sole = await app.signIn('sole@semu.example')
    const { items } = await (await app.request('GET', '/v1/me/term-agreements', { token: sole.token })).json()
    const taxTerm = (items as Agreement[]).find((a) => a.term.code === 'TAX_SERVICE')

    const response = await app.request('POST', '/v1/me/term-agreements', {
      token: sole.token,
      body: { decisions: [{ termId: taxTerm?.term.id, agreed: false }] },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'REQUIRED_TERM_DECLINED' })
  })

  it('지난 약관 버전에 대한 답은 거절합니다', async () => {
    const owner = await app.signIn('owner@semu.example')
    const outdatedId = demoTerms().find((t) => t.code === 'SERVICE' && t.version === '2025-07')?.id

    const response = await app.request('POST', '/v1/me/term-agreements', {
      token: owner.token,
      body: { decisions: [{ termId: outdatedId, agreed: true }] },
    })

    expect(response.status).toBe(409)
  })

  it('무료 회사에는 세무 약관을 보여 주지 않습니다', async () => {
    const owner = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })
    const { items } = await (await app.request('GET', '/v1/me/term-agreements', { token: owner.token })).json()

    expect((items as Agreement[]).map((a) => a.term.code)).not.toContain('TAX_SERVICE')
  })
})
