import { describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

async function invite(app: TestApp, token: string, email: string): Promise<{ id: string; status: number }> {
  const response = await app.request('POST', '/v1/invitations', {
    token,
    body: { email, access: 'MEMBER', roleIds: [] },
  })
  const body = await response.json()
  return { id: body.id ?? body.invitationId, status: response.status }
}

async function signupTerms(app: TestApp): Promise<string[]> {
  const terms = await (await app.request('GET', '/v1/terms?purpose=SIGNUP')).json()
  return terms.items.filter((t: { required: boolean }) => t.required).map((t: { id: string }) => t.id)
}

describe('초대', () => {
  it('초대받은 새 사람이 링크로 가입하면 그 회사의 구성원이 됩니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')

    const created = await invite(app, owner.token, 'New.Person@semu.example')
    expect(created.status).toBe(201)
    const token = await app.lastMailToken()

    const preview = await app.request('POST', '/v1/invitations:preview', { body: { token } })
    expect(await preview.json()).toMatchObject({
      companyName: '주식회사 세무',
      email: 'new.person@semu.example',
      status: 'PENDING',
      isExistingUser: false,
    })

    const missingTerms = await app.request('POST', '/v1/invitations:accept', {
      body: { token, name: '새 직원', password: 'welcome123' },
    })
    expect(missingTerms.status).toBe(422)

    const accepted = await app.request('POST', '/v1/invitations:accept', {
      body: { token, name: '새 직원', password: 'welcome123', agreedTermIds: await signupTerms(app) },
    })
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('set-cookie')).toMatch(/^semu_refresh=/)
    expect(await accepted.json()).toMatchObject({ company: { id: DEMO_COMPANY_IDS.corporation } })

    const list = await (await app.request('GET', '/v1/invitations', { token: owner.token })).json()
    expect(list.items[0]).toMatchObject({ status: 'ACCEPTED', allowedActions: [] })
    const again = await app.request('POST', '/v1/invitations:accept', { body: { token, password: 'welcome123' } })
    expect(again.status).toBe(410)
    expect(await again.json()).toMatchObject({ reason: 'INVITATION_ALREADY_ACCEPTED' })
    await app.dispose()
  })

  it('기존 사용자는 로그인한 채로 수락할 수 있고, 다른 계정의 수락은 거절합니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')
    await invite(app, owner.token, 'sole@semu.example')
    const token = await app.lastMailToken()
    const stranger = await app.signIn('member@semu.example')
    const sole = await app.signIn('sole@semu.example')

    const mismatch = await app.request('POST', '/v1/invitations:accept', { token: stranger.token, body: { token } })
    const accepted = await app.request('POST', '/v1/invitations:accept', { token: sole.token, body: { token } })

    expect(mismatch.status).toBe(403)
    expect(accepted.status).toBe(200)
    const body = await accepted.json()
    expect(body.companies.map((c: { id: string }) => c.id).sort()).toEqual(
      [DEMO_COMPANY_IDS.corporation, DEMO_COMPANY_IDS.individual].sort(),
    )
    await app.dispose()
  })

  it('로그인하지 않았으면 기존 계정의 비밀번호로 수락합니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')
    await invite(app, owner.token, 'sole@semu.example')
    const token = await app.lastMailToken()

    const wrong = await app.request('POST', '/v1/invitations:accept', { body: { token, password: 'nope1234' } })
    const right = await app.request('POST', '/v1/invitations:accept', { body: { token, password: DEMO_PASSWORD } })

    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
    await app.dispose()
  })

  it('유효한 초대가 있거나 이미 구성원이면 새 초대를 거절하고, 유효한 초대는 취소할 수 있습니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')

    const first = await invite(app, owner.token, 'twice@semu.example')
    const second = await invite(app, owner.token, 'twice@semu.example')
    const member = await invite(app, owner.token, 'member@semu.example')
    const canceled = await app.request('POST', `/v1/invitations/${first.id}:cancel`, { token: owner.token })
    const reinvite = await invite(app, owner.token, 'twice@semu.example')

    expect(second.status).toBe(409)
    expect(second.id).toBe(first.id)
    expect(member.status).toBe(409)
    expect(await canceled.json()).toMatchObject({ status: 'CANCELED', allowedActions: ['REINVITE'] })
    expect(reinvite.status).toBe(201)
    await app.dispose()
  })

  it('일반 구성원은 초대할 수 없습니다', async () => {
    const app = makeTestApp()
    const member = await app.signIn('member@semu.example')

    expect((await invite(app, member.token, 'x@semu.example')).status).toBe(403)
    await app.dispose()
  })

  it('모르는 링크 토큰이면 404로 답합니다', async () => {
    const app = makeTestApp()

    expect((await app.request('POST', '/v1/invitations:preview', { body: { token: 'nope' } })).status).toBe(404)
    await app.dispose()
  })
})

describe('감사 로그', () => {
  it('보안 동작을 기록하고 관리자에게만 보여 줍니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')
    await invite(app, owner.token, 'audited@semu.example')
    const member = await app.signIn('member@semu.example')

    const logs = await (await app.request('GET', '/v1/audit-logs', { token: owner.token })).json()

    expect(logs.items.map((entry: { action: string }) => entry.action)).toContain('INVITATION_CREATED')
    expect((await app.request('GET', '/v1/audit-logs', { token: member.token })).status).toBe(403)
    await app.dispose()
  })
})

describe('대리인 범위 토큰으로 초대 수락', () => {
  it('대리인 범위 토큰을 무시하지 않고 403 TOKEN_SCOPE_MISMATCH로 거절합니다', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@semu.example')
    await invite(app, owner.token, 'agent@agency.example')
    const token = await app.lastMailToken()
    const agent = await app.signIn('agent@agency.example')
    const switched = await app.request('POST', '/v1/auth/sessions:switch-agency', { cookie: agent.cookie })
    const agencyToken = (await switched.json()).accessToken

    const response = await app.request('POST', '/v1/invitations:accept', {
      token: agencyToken,
      body: { token, password: DEMO_PASSWORD },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'COMPANY' })
    const preview = await (await app.request('POST', '/v1/invitations:preview', { body: { token } })).json()
    expect(preview).toMatchObject({ status: 'PENDING' })
    await app.dispose()
  })
})
