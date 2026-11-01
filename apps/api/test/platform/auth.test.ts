import { decode } from 'hono/jwt'
import { describe, expect, it } from 'vitest'
import { PLATFORM_SEED } from '../../src/modules/platform/platform.seed'
import { CORP, createPlatformTestContext, USERS } from '../helpers/test-app'

const ADMIN_EMAIL = `${USERS.admin}@example.com`

describe('session login', () => {
  it('signs in with email and password and sets the session and CSRF cookies', async () => {
    const ctx = await createPlatformTestContext()
    const agent = ctx.anonymous()
    const response = await agent.call('POST', '/api/login/', { json: { email: ADMIN_EMAIL.toUpperCase(), password: PLATFORM_SEED.password } })
    expect(response.status).toBe(200)
    expect(agent.cookies.has('sessionid')).toBe(true)
    expect(agent.cookies.get('csrftoken')).toBe(agent.cookies.get('nexus_csrftoken'))
    const me = await agent.call('GET', '/api/user/me/')
    expect(me.status).toBe(200)
    const body = (await me.json()) as { id: string; companies: { id: string; is_system_admin: boolean }[] }
    expect(body.id).toBe(USERS.admin)
    expect(body.companies).toEqual([expect.objectContaining({ id: CORP, is_system_admin: true })])
  })

  it('rejects a wrong password without revealing which part was wrong', async () => {
    const ctx = await createPlatformTestContext()
    const response = await ctx.anonymous().call('POST', '/api/login', { json: { email: ADMIN_EMAIL, password: 'wrong1234' } })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('requires the CSRF header on unsafe methods when authenticating with the cookie', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login(ADMIN_EMAIL)
    const without = await agent.call('PATCH', '/api/user/me/term-agreements/?purpose=signup', { json: { agreements: [] }, csrf: false })
    expect(without.status).toBe(403)
    expect(await without.json()).toMatchObject({ code: 'CSRF_FAILED' })
    const forged = await agent.call('PATCH', '/api/user/me/term-agreements/?purpose=signup', { json: { agreements: [] }, csrf: 'forged' })
    expect(forged.status).toBe(403)
    const valid = await agent.call('PATCH', '/api/user/me/term-agreements/?purpose=signup', { json: { agreements: [] } })
    expect(valid.status).toBe(200)
  })

  it('binds cookie sessions to companies by membership', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login(ADMIN_EMAIL)
    expect((await agent.call('GET', `/api/company/${CORP}/`)).status).toBe(200)
    expect((await agent.call('GET', '/api/company/c-free/')).status).toBe(403)
  })

  it('revokes the session on logout', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login(ADMIN_EMAIL)
    const cookies = new Map(agent.cookies)
    expect((await agent.call('POST', '/api/logout/')).status).toBe(204)
    agent.cookies.clear()
    for (const [name, value] of cookies) agent.cookies.set(name, value)
    expect((await agent.call('GET', '/api/user/me')).status).toBe(401)
  })

  it('serves the demo credentials, which sign in to a read-only account', async () => {
    const ctx = await createPlatformTestContext()
    const demo = (await (await ctx.anonymous().call('GET', '/api/member/demo/')).json()) as { email: string; password: string }
    const agent = await ctx.login(demo.email, demo.password)
    const write = await agent.call('PATCH', `/api/company/${CORP}/`, { json: { phone: '0299998888' } })
    expect(write.status).toBe(403)
    expect(await write.json()).toMatchObject({ code: 'DEMO_READ_ONLY' })
  })
})

describe('company JWT issuance', () => {
  it('issues an HS256 token with the company claims for members', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login(ADMIN_EMAIL)
    const response = await agent.call('POST', '/api/user/me/jwt/', { json: { company_id: CORP } })
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    const { header, payload } = decode(token)
    expect(header.alg).toBe('HS256')
    expect(payload).toMatchObject({ sub: USERS.admin, company_id: CORP, user_type: 0 })
    expect(payload['exp']).toBe(Date.parse(ctx.clock.now()) / 1000 + 3600)
    expect((await ctx.call(token, 'GET', `/api/company/${CORP}/menu/menu-tree/latest`)).status).toBe(200)
  })

  it('refuses companies the user neither belongs to nor is assigned to', async () => {
    const ctx = await createPlatformTestContext()
    const member = await ctx.login(ADMIN_EMAIL)
    expect((await member.call('POST', '/api/user/me/jwt', { json: { company_id: 'c-free' } })).status).toBe(403)
    const agent = await ctx.login(`${USERS.agent}@example.com`)
    expect((await agent.call('POST', '/api/user/me/jwt', { json: { company_id: CORP } })).status).toBe(200)
    expect((await agent.call('POST', '/api/user/me/jwt', { json: { company_id: 'c-ind' } })).status).toBe(403)
  })

  it('stops accepting a token after it expires on the injected clock', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.login(ADMIN_EMAIL)
    const { token } = (await (await agent.call('POST', '/api/user/me/jwt', { json: { company_id: CORP } })).json()) as { token: string }
    ctx.setNow('2026-11-01T10:00:01+09:00')
    expect((await ctx.call(token, 'GET', `/api/company/${CORP}/`)).status).toBe(401)
  })
})

describe('password reset', () => {
  it('mails a one-time token and replaces the password with it', async () => {
    const ctx = await createPlatformTestContext()
    const anonymous = ctx.anonymous()
    expect((await anonymous.call('POST', `/api/request-password-change-email/${encodeURIComponent(ADMIN_EMAIL)}/`)).status).toBe(202)
    const mail = ctx.messenger.outbox.find((message) => message.channel === 'mail' && message.template === 'password_reset')
    const token = mail?.channel === 'mail' ? mail.token : undefined
    expect(token).toBeDefined()
    expect((await anonymous.call('GET', `/api/password-change/${token}`)).status).toBe(200)
    expect((await anonymous.call('POST', `/api/password-change/${token}/`, { json: { password: 'short', confirm_password: 'short' } })).status).toBe(422)
    expect((await anonymous.call('POST', `/api/password-change/${token}/`, { json: { password: 'newpass99', confirm_password: 'newpass99' } })).status).toBe(204)
    await expect(ctx.login(ADMIN_EMAIL)).rejects.toThrow()
    await ctx.login(ADMIN_EMAIL, 'newpass99')
    expect((await anonymous.call('GET', `/api/password-change/${token}`)).status).toBe(410)
  })
})
