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

describe('invitations', () => {
  it('invites a new person who signs up through the link and lands in the company', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@alfred.example')

    const created = await invite(app, owner.token, 'New.Person@alfred.example')
    expect(created.status).toBe(201)
    const token = await app.lastMailToken()

    const preview = await app.request('POST', '/v1/invitations:preview', { body: { token } })
    expect(await preview.json()).toMatchObject({
      companyName: '주식회사 알프레드',
      email: 'new.person@alfred.example',
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

  it('lets an existing user accept while signed in, and refuses another account', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@alfred.example')
    await invite(app, owner.token, 'sole@alfred.example')
    const token = await app.lastMailToken()
    const stranger = await app.signIn('member@alfred.example')
    const sole = await app.signIn('sole@alfred.example')

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

  it('accepts with the password of an existing account when not signed in', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@alfred.example')
    await invite(app, owner.token, 'sole@alfred.example')
    const token = await app.lastMailToken()

    const wrong = await app.request('POST', '/v1/invitations:accept', { body: { token, password: 'nope1234' } })
    const right = await app.request('POST', '/v1/invitations:accept', { body: { token, password: DEMO_PASSWORD } })

    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
    await app.dispose()
  })

  it('refuses a duplicate pending invitation and an existing member, then cancels', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@alfred.example')

    const first = await invite(app, owner.token, 'twice@alfred.example')
    const second = await invite(app, owner.token, 'twice@alfred.example')
    const member = await invite(app, owner.token, 'member@alfred.example')
    const canceled = await app.request('POST', `/v1/invitations/${first.id}:cancel`, { token: owner.token })
    const reinvite = await invite(app, owner.token, 'twice@alfred.example')

    expect(second.status).toBe(409)
    expect(second.id).toBe(first.id)
    expect(member.status).toBe(409)
    expect(await canceled.json()).toMatchObject({ status: 'CANCELED', allowedActions: ['REINVITE'] })
    expect(reinvite.status).toBe(201)
    await app.dispose()
  })

  it('does not let a member invite', async () => {
    const app = makeTestApp()
    const member = await app.signIn('member@alfred.example')

    expect((await invite(app, member.token, 'x@alfred.example')).status).toBe(403)
    await app.dispose()
  })

  it('answers 404 for an unknown link token', async () => {
    const app = makeTestApp()

    expect((await app.request('POST', '/v1/invitations:preview', { body: { token: 'nope' } })).status).toBe(404)
    await app.dispose()
  })
})

describe('audit logs', () => {
  it('records security actions for admins only', async () => {
    const app = makeTestApp()
    const owner = await app.signIn('owner@alfred.example')
    await invite(app, owner.token, 'audited@alfred.example')
    const member = await app.signIn('member@alfred.example')

    const logs = await (await app.request('GET', '/v1/audit-logs', { token: owner.token })).json()

    expect(logs.items.map((entry: { action: string }) => entry.action)).toContain('INVITATION_CREATED')
    expect((await app.request('GET', '/v1/audit-logs', { token: member.token })).status).toBe(403)
    await app.dispose()
  })
})
