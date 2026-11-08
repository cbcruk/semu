import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BusinessStatusCheck } from '../companies/business-status-check.ts'
import { DEMO_COMPANY_IDS, DEMO_USER_IDS } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('지금 회사(/v1/companies/current)', () => {
  it('토큰의 회사를 읽고 ETag로 고칩니다', async () => {
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

  it('일반 구성원은 회사 정보를 읽기만 하고 고치지 못합니다', async () => {
    const { token } = await app.signIn('member@semu.example')

    expect((await app.request('GET', '/v1/companies/current', { token })).status).toBe(200)
    const response = await app.request('PATCH', '/v1/companies/current', { token, body: { industry: 'x' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'company:update' })
  })
})

describe('회사 등록(POST /v1/companies)', () => {
  it('로그인한 사용자가 회사를 등록하면 그 회사로 전환할 수 있습니다', async () => {
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

  it('검증번호가 틀린 사업자등록번호는 거절합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/companies', {
      token,
      body: { name: '틀린 회사', businessNumber: '1238145601', businessType: 'INDIVIDUAL' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'BUSINESS_NUMBER_INVALID' })
  })

  it('국세청 조회에서 폐업인 사업자는 422로 거절합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')
    // Integrations 가짜 상태조회는 끝자리 8을 폐업으로 답합니다.
    const register = (businessNumber: string) =>
      app.request('POST', '/v1/companies', {
        token,
        body: { name: '폐업한 회사', businessNumber, businessType: 'INDIVIDUAL' },
      })

    const closed = await register('101-86-00078')

    expect(closed.status).toBe(422)
    expect(await closed.json()).toMatchObject({ code: 'BUSINESS_CLOSED' })
    expect((await register('101-86-00006')).status).toBe(201)
  })

  it.each([
    ['휴업', '101-86-00097'],
    ['미등록(알 수 없음)', '101-86-00059'],
  ])('국세청 조회에서 %s인 사업자는 등록합니다', async (_status, businessNumber) => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/companies', {
      token,
      body: { name: '새 회사', businessNumber, businessType: 'INDIVIDUAL' },
    })

    expect(response.status).toBe(201)
  })

  it('사업자 상태조회가 실패해도 등록합니다', async () => {
    const failing = makeTestApp({ layers: [BusinessStatusCheck.layerFailing] })
    try {
      const { token } = await failing.signIn('owner@semu.example')

      const response = await failing.request('POST', '/v1/companies', {
        token,
        body: { name: '새 회사', businessNumber: '101-86-00078', businessType: 'INDIVIDUAL' },
      })

      expect(response.status).toBe(201)
    } finally {
      await failing.dispose()
    }
  })

  it('토큰이 없으면 401로 답합니다', async () => {
    const response = await app.request('POST', '/v1/companies', {
      body: { name: '회사', businessNumber: '1018600006', businessType: 'INDIVIDUAL' },
    })

    expect(response.status).toBe(401)
  })
})

describe('구성원(/v1/users)', () => {
  it('지금 회사의 구성원만 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/users', { token })).json()

    expect(body.totalCount).toBe(2)
    expect(body.items.map((m: { email: string; isMe: boolean }) => [m.email, m.isMe])).toEqual([
      ['owner@semu.example', true],
      ['member@semu.example', false],
    ])
  })

  it('구성원을 관리자로 올리면 그 사람의 지금 access token을 폐기합니다', async () => {
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

  it('소유자와 마지막 관리자는 강등하거나 내보낼 수 없습니다', async () => {
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

  it('내보낸 구성원은 그 회사에 더 접근하지 못합니다', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')

    const removed = await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.member}`, { token: owner.token })

    expect(removed.status).toBe(204)
    expect((await app.request('GET', '/v1/me', { token: member.token })).status).toBe(401)
    const again = await app.signIn('member@semu.example')
    expect(again.body).toMatchObject({ companies: [] })
    expect(again.body).toHaveProperty('onboardingToken')
  })

  it('가입 토큰은 회사를 하나 등록하면 다시 쓸 수 없습니다', async () => {
    const owner = await app.signIn('owner@semu.example')
    await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.member}`, { token: owner.token })
    const onboarding = String((await app.signIn('member@semu.example')).body.onboardingToken)
    const register = (businessNumber: string) =>
      app.request('POST', '/v1/companies', {
        token: onboarding,
        body: { name: '새 회사', businessNumber, businessType: 'INDIVIDUAL' },
      })

    expect((await register('101-86-00006')).status).toBe(201)
    expect((await register('101-86-00006')).status).toBe(401)
  })

  it('구성원 관리 권한이 없는 구성원은 구성원을 보거나 관리할 수 없습니다', async () => {
    const { token } = await app.signIn('member@semu.example')

    expect((await app.request('GET', '/v1/users', { token })).status).toBe(403)
    expect((await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.owner}`, { token })).status).toBe(403)
  })

  it('다른 회사의 사용자면 404로 답합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    expect((await app.request('GET', `/v1/users/${DEMO_USER_IDS.sole}`, { token })).status).toBe(404)
  })
})

describe('권한 그룹(/v1/roles)', () => {
  it('넣을 수 있는 권한으로 권한 그룹을 만들고 관리자 전용 권한은 거절합니다', async () => {
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

  it('권한 그룹을 고치면 그 그룹을 가진 구성원의 권한도 새로 계산합니다', async () => {
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

  it('권한 그룹을 지우면 구성원에게서도 떼어 냅니다', async () => {
    const { token } = await app.signIn('owner@semu.example')
    const { items } = await (await app.request('GET', '/v1/roles', { token })).json()

    expect((await app.request('DELETE', `/v1/roles/${items[0].id}`, { token })).status).toBe(204)
    const member = await (await app.request('GET', `/v1/users/${DEMO_USER_IDS.member}`, { token })).json()
    expect(member.roleIds).toEqual([])
  })

  it('그룹 템플릿과 넣을 수 있는 권한만 보여 줍니다', async () => {
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
