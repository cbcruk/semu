import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_USER_IDS } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('/v1/companies/current', () => {
  it('reads and updates the company of the token with an ETag', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const read = await app.request('GET', '/v1/companies/current', { token })
    expect(read.status).toBe(200)
    expect(read.headers.get('etag')).toBe('"1"')
    expect(await read.json()).toMatchObject({ id: DEMO_COMPANY_IDS.corporation, businessNumber: '1238145600' })

    const stale = await app.request('PATCH', '/v1/companies/current', {
      token,
      headers: { 'if-match': '"0"' },
      body: { industry: '소프트웨어 개발' },
    })
    const updated = await app.request('PATCH', '/v1/companies/current', {
      token,
      headers: { 'if-match': '"1"' },
      body: { industry: '소프트웨어 개발' },
    })

    expect(stale.status).toBe(412)
    expect(updated.status).toBe(200)
    expect(updated.headers.get('etag')).toBe('"2"')
    expect(await updated.json()).toMatchObject({ industry: '소프트웨어 개발', name: '주식회사 세무' })
  })

  it('lets a member read but not update the company', async () => {
    const { token } = await app.signIn('member@semu.example')

    expect((await app.request('GET', '/v1/companies/current', { token })).status).toBe(200)
    const response = await app.request('PATCH', '/v1/companies/current', { token, body: { industry: 'x' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'company:update' })
  })
})

describe('POST /v1/companies', () => {
  it('registers a company for a signed-in user, who can then switch to it', async () => {
    const first = await app.signIn('owner@semu.example')

    const created = await app.request('POST', '/v1/companies', {
      token: first.token,
      body: { name: '세무 2호점', businessNumber: '220-81-62517', businessType: 'CORPORATION' },
    })

    expect(created.status).toBe(409)
    const fresh = await app.request('POST', '/v1/companies', {
      token: first.token,
      body: { name: '새 회사', businessNumber: '101-86-00006', businessType: 'INDIVIDUAL' },
    })
    expect(fresh.status).toBe(201)
    const company = await fresh.json()
    const switched = await app.request('POST', '/v1/auth/sessions:switch-company', {
      cookie: first.cookie,
      body: { companyId: company.id },
    })
    expect(await switched.json()).toMatchObject({ company: { id: company.id, actorKind: 'CLIENT' } })
  })

  it('rejects a business number with a wrong check digit', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/companies', {
      token,
      body: { name: '틀린 회사', businessNumber: '1238145601', businessType: 'INDIVIDUAL' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'BUSINESS_NUMBER_INVALID' })
  })

  it('answers 401 without a token', async () => {
    const response = await app.request('POST', '/v1/companies', {
      body: { name: '회사', businessNumber: '1018600006', businessType: 'INDIVIDUAL' },
    })

    expect(response.status).toBe(401)
  })
})

describe('/v1/users', () => {
  it('lists the members of the current company only', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/users', { token })).json()

    expect(body.totalCount).toBe(2)
    expect(body.items.map((m: { email: string; isMe: boolean }) => [m.email, m.isMe])).toEqual([
      ['owner@semu.example', true],
      ['member@semu.example', false],
    ])
  })

  it('promotes a member to admin and revokes their current access token', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')

    const response = await app.request('POST', `/v1/users/${DEMO_USER_IDS.member}:change-access`, {
      token: owner.token,
      body: { access: 'ADMIN', roleIds: [] },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ access: 'ADMIN', roleIds: [], version: 2 })
    expect((await app.request('GET', '/v1/me', { token: member.token })).status).toBe(401)
    const refreshed = await app.request('POST', '/v1/auth/sessions:refresh', { cookie: member.cookie })
    const me = await (await app.request('GET', '/v1/me', { token: (await refreshed.json()).accessToken })).json()
    expect(me.permissions).toEqual(['*'])
  })

  it('protects the owner and the last admin', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const demote = await app.request('POST', `/v1/users/${DEMO_USER_IDS.owner}:change-access`, {
      token,
      body: { access: 'MEMBER', roleIds: [] },
    })
    const remove = await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.owner}`, { token })

    expect(demote.status).toBe(409)
    expect(await demote.json()).toMatchObject({ code: 'OWNER_IMMUTABLE' })
    expect(remove.status).toBe(409)
  })

  it('removes a member, who then cannot reach the company', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')

    const removed = await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.member}`, { token: owner.token })

    expect(removed.status).toBe(204)
    expect((await app.request('GET', '/v1/me', { token: member.token })).status).toBe(401)
    const again = await app.signIn('member@semu.example')
    expect(again.body).toMatchObject({ companies: [] })
    expect(again.body).toHaveProperty('onboardingToken')
  })

  it('does not let a member without the user-management permissions see or manage members', async () => {
    const { token } = await app.signIn('member@semu.example')

    expect((await app.request('GET', '/v1/users', { token })).status).toBe(403)
    expect((await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.owner}`, { token })).status).toBe(403)
  })

  it('answers 404 for a user of another company', async () => {
    const { token } = await app.signIn('owner@semu.example')

    expect((await app.request('GET', `/v1/users/${DEMO_USER_IDS.sole}`, { token })).status).toBe(404)
  })
})

describe('/v1/roles', () => {
  it('creates a role from grantable permissions and refuses admin-only ones', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const refused = await app.request('POST', '/v1/roles', {
      token,
      body: { name: '설정 관리', permissions: ['member:*', 'company:update'] },
    })
    const created = await app.request('POST', '/v1/roles', {
      token,
      body: { name: '급여 담당', permissions: ['payroll-ledger:*', 'payslip:read'], templateCode: 'PAYROLL' },
    })
    const duplicate = await app.request('POST', '/v1/roles', { token, body: { name: '급여 담당', permissions: [] } })

    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ code: 'PERMISSION_NOT_GRANTABLE', permissions: ['member:*'] })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ name: '급여 담당', memberCount: 0, version: 1 })
    expect(duplicate.status).toBe(409)
  })

  it('updates a role and refreshes the permissions of its holders', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')
    const { items } = await (await app.request('GET', '/v1/roles', { token: owner.token })).json()
    const role = items[0]

    const updated = await app.request('PUT', `/v1/roles/${role.id}`, {
      token: owner.token,
      headers: { 'if-match': `"${role.version}"` },
      body: { name: role.name, permissions: ['employee:read'] },
    })

    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ memberCount: 1, permissions: ['employee:read'] })
    expect((await app.request('GET', '/v1/me', { token: member.token })).status).toBe(401)
  })

  it('deletes a role and detaches it from members', async () => {
    const { token } = await app.signIn('owner@semu.example')
    const { items } = await (await app.request('GET', '/v1/roles', { token })).json()

    expect((await app.request('DELETE', `/v1/roles/${items[0].id}`, { token })).status).toBe(204)
    const member = await (await app.request('GET', `/v1/users/${DEMO_USER_IDS.member}`, { token })).json()
    expect(member.roleIds).toEqual([])
  })

  it('lists templates and only grantable permissions', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const templates = await (await app.request('GET', '/v1/role-templates', { token })).json()
    const permissions = await (await app.request('GET', '/v1/permissions', { token })).json()

    expect(templates.items.map((t: { code: string }) => t.code)).toEqual([
      'BOOKKEEPING',
      'HR',
      'PAYROLL',
      'TAX',
      'SETTINGS',
    ])
    const names = permissions.items.map((p: { permission: string }) => p.permission)
    expect(names).toContain('employee:read')
    expect(names).not.toContain('member:update')
    expect(names).not.toContain('audit-log:read')
  })
})
