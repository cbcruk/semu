import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER_IDS } from '../demo-seed.ts'
import { makeTestApp } from '../testing-http.ts'
import type { TestApp } from '../testing-http.ts'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('agent permissions over HTTP (D5)', () => {
  it('keeps an assigned agent out of member management in the client company', async () => {
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

  it('still lets the agent read the client company', async () => {
    const { token } = await app.signIn('agent@agency.example')

    expect((await app.request('GET', '/v1/companies/current', { token })).status).toBe(200)
  })

  it('leaves the client admin with the wildcard and member management', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const me = await (await app.request('GET', '/v1/me', { token })).json()
    const users = await app.request('GET', '/v1/users', { token })
    const conversation = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(me.permissions).toEqual(['*'])
    expect(users.status).toBe(200)
    expect(conversation.status).toBe(201)
  })
})
