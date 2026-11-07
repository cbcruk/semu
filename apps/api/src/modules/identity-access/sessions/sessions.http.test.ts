import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD } from '../demo-seed.ts'
import { AGENT_PERMISSIONS } from '../permissions/permission-catalog.ts'
import { cookieOf, makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('로그인(POST /v1/auth/sessions)', () => {
  it('로그인하면 HttpOnly refresh 쿠키를 심고 마지막으로 쓴 회사, 없으면 처음 소속된 회사에 토큰을 묶습니다', async () => {
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

  it('없는 이메일과 틀린 비밀번호에 같은 401로 답합니다', async () => {
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

  it('비밀번호를 다섯 번 틀리면 계정을 잠가 맞는 비밀번호도 받지 않습니다', async () => {
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

  it('접근할 수 없는 회사는 있는지 없는지 드러내지 않고 거절합니다', async () => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'owner@semu.example', password: DEMO_PASSWORD, companyId: DEMO_COMPANY_IDS.individual },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'COMPANY_NOT_FOUND' })
  })
})

describe('내 정보(GET /v1/me)', () => {
  it('관리자의 계산된 권한·플랜·전환할 수 있는 회사를 돌려줍니다', async () => {
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

  it('일반 구성원은 기본 권한에 권한 그룹들의 합집합을 더해 받습니다', async () => {
    const { token } = await app.signIn('member@semu.example')

    const body = await (await app.request('GET', '/v1/me', { token })).json()

    expect(body.membership).toMatchObject({ access: 'MEMBER', isOwner: false })
    expect(body.permissions).toEqual(expect.arrayContaining(['company:read', 'evidence:*', 'bank-transaction:*']))
    expect(body.permissions).not.toContain('member:update')
  })

  it('배정된 대리인 담당자는 대리인 권한을 가진 AGENCY 행위자이고, 팀장은 팀원의 배정 회사도 봅니다', async () => {
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.individual })
    const manager = await app.signIn('manager@agency.example')

    expect(agent.body).toMatchObject({ company: { id: DEMO_COMPANY_IDS.individual, actorKind: 'AGENCY' } })
    const me = await (await app.request('GET', '/v1/me', { token: manager.token })).json()
    expect(me.permissions).toEqual([...AGENT_PERMISSIONS].sort())
    expect(me).not.toHaveProperty('membership')
    expect(me.companies.map((c: { id: string }) => c.id).sort()).toEqual(
      [DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.individual].sort(),
    )
  })

  it('아직 동의하지 않은 세무 기장 고객에게 동의할 세무 약관을 보여 줍니다', async () => {
    const { token } = await app.signIn('sole@semu.example')

    expect(await (await app.request('GET', '/v1/me', { token })).json()).toMatchObject({
      pendingTermCodes: ['TAX_SERVICE'],
    })
  })

  it('무료 회사에는 모든 플랜의 프로모션을 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    expect(await (await app.request('GET', '/v1/me', { token })).json()).toMatchObject({
      company: { plans: [] },
      promotions: ['TAXATION', 'PAYROLL'],
    })
  })

  it('토큰이 없으면 401로 답합니다', async () => {
    expect((await app.request('GET', '/v1/me')).status).toBe(401)
  })
})

describe('토큰 갱신·회사 전환·로그아웃', () => {
  it('refresh token을 회전하고 이전 access token을 폐기합니다', async () => {
    const first = await app.signIn('owner@semu.example')

    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })

    expect(refreshed.status).toBe(200)
    const body = await refreshed.json()
    expect(cookieOf(refreshed)).not.toBe(first.cookie)
    expect((await app.request('GET', '/v1/me', { token: first.token })).status).toBe(401)
    expect((await app.request('GET', '/v1/me', { token: body.accessToken })).status).toBe(200)
  })

  it('이미 회전한 refresh token이 다시 오면 세션 전체를 폐기합니다', async () => {
    const first = await app.signIn('owner@semu.example')
    const rotated = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })
    const latest = cookieOf(rotated)

    const replay = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })
    const afterReplay = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: latest })

    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ code: 'SESSION_INVALID' })
    expect(afterReplay.status).toBe(401)
  })

  it('회사를 전환하면 새 회사에 묶인 새 토큰을 줍니다', async () => {
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

  it('마지막으로 쓴 회사를 기억해 다음 로그인에 씁니다', async () => {
    const first = await app.signIn('owner@semu.example')
    await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: DEMO_COMPANY_IDS.free },
    })

    const again = await app.signIn('owner@semu.example')

    expect(again.body).toMatchObject({ company: { id: DEMO_COMPANY_IDS.free } })
  })

  it('사용자가 접근할 수 없는 회사로는 전환하지 않습니다', async () => {
    const first = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: DEMO_COMPANY_IDS.individual },
    })

    expect(response.status).toBe(404)
  })

  it('로그아웃하면 쿠키를 지우고 두 토큰을 모두 무효로 합니다', async () => {
    const first = await app.signIn('owner@semu.example')

    const response = await app.request('DELETE', '/v1/auth/sessions/current', { cookie: first.cookie })

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await app.request('GET', '/v1/me', { token: first.token })).status).toBe(401)
    expect((await app.request('POST', '/v1/auth/sessions:refresh', { cookie: first.cookie })).status).toBe(401)
  })

  it('쿠키 없이 토큰을 갱신하면 401로 답합니다', async () => {
    expect((await app.request('POST', '/v1/auth/sessions:refresh')).status).toBe(401)
  })
})

describe('데모 계정', () => {
  it('읽기 전용 데모 계정은 비밀번호 없이 로그인합니다', async () => {
    const response = await app.request('POST', '/v1/auth/sessions:demo')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ user: { isDemo: true }, company: { id: DEMO_COMPANY_IDS.demo } })
  })

  it('누구도 비밀번호로 데모 계정에 로그인할 수 없습니다', async () => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'demo@semu.example', password: DEMO_PASSWORD },
    })

    expect(response.status).toBe(401)
  })
})
