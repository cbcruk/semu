import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER_IDS } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('HTTP로 본 세무 대리인 권한 (D5)', () => {
  it('배정된 대리인은 고객 회사의 구성원 관리에 들어오지 못합니다', async () => {
    const { token } = await app.signIn('agent@agency.example')

    const users = await app.request('GET', '/v1/users', { token })
    const roles = await app.request('GET', '/v1/roles', { token })
    const invite = await app.request('POST', '/v1/invitations', {
      token,
      body: { email: 'someone@semu.example', access: 'MEMBER', roleIds: [] },
    })
    const remove = await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.member}`, { token })

    expect(users.status).toBe(403)
    expect(roles.status).toBe(403)
    expect(invite.status).toBe(403)
    expect(await invite.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'invitation:create' })
    expect(remove.status).toBe(403)
  })

  it('대리인도 고객 회사 정보는 읽을 수 있습니다', async () => {
    const { token } = await app.signIn('agent@agency.example')

    expect((await app.request('GET', '/v1/companies/current', { token })).status).toBe(200)
  })

  it('고객 관리자는 와일드카드 권한과 구성원 관리를 그대로 가집니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const me = await (await app.request('GET', '/v1/me', { token })).json()
    const users = await app.request('GET', '/v1/users', { token })
    const conversation = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(me.permissions).toEqual(['*'])
    expect(users.status).toBe(200)
    expect(conversation.status).toBe(201)
  })
})
