import { describe, expect, it } from 'vitest'
import { queryOne } from '../../src/db/query'
import type { PlatformTestContext } from '../helpers/test-app'
import { CORP, createPlatformTestContext, USERS } from '../helpers/test-app'

async function invite(ctx: PlatformTestContext, email: string, roleIds: string[] = []): Promise<{ status: number; id?: string; token?: string }> {
  const admin = await ctx.token(USERS.admin, CORP)
  const response = await ctx.call(admin, 'POST', `/api/company/${CORP}/internal-invitation/`, { json: { email, is_admin: false, role_ids: roleIds } })
  if (response.status !== 201) return { status: response.status }
  const body = (await response.json()) as { id: string }
  const mail = ctx.messenger.outbox.findLast((message) => message.channel === 'mail' && message.template === 'internal_invitation' && message.to === email)
  return { status: 201, id: body.id, ...(mail?.channel === 'mail' && mail.token !== undefined ? { token: mail.token } : {}) }
}

const NEW_USER = { password: 'invitee12', confirm_password: 'invitee12', name: '신입', agreements: [{ code: 'service', is_agreed: true }, { code: 'privacy', is_agreed: true }] }

describe('internal invitations', () => {
  it('lets a new user accept with a password and joins them with the invited role', async () => {
    const ctx = await createPlatformTestContext()
    const { token } = await invite(ctx, 'new@example.com', ['r-tax'])
    const anonymous = ctx.anonymous()
    const described = await anonymous.call('GET', `/api/internal-invitation/${token}/`)
    expect(await described.json()).toMatchObject({ company_id: CORP, email: 'new@example.com', is_existing_user: false, status: 'pending' })

    const accepted = await anonymous.call('POST', `/api/internal-invitation/${token}/accept/`, { json: NEW_USER })
    expect(accepted.status).toBe(201)
    expect(anonymous.cookies.has('sessionid')).toBe(true)
    const me = (await (await anonymous.call('GET', '/api/user/me')).json()) as { id: string; companies: { id: string }[] }
    expect(me.companies.map((company) => company.id)).toEqual([CORP])
    const role = queryOne<{ role_id: string }>(ctx.db, 'SELECT role_id FROM membership_roles WHERE company_id = ? AND user_id = ?', [CORP, me.id])
    expect(role?.role_id).toBe('r-tax')

    expect((await ctx.anonymous().call('POST', `/api/internal-invitation/${token}/accept`, { json: NEW_USER })).status).toBe(410)
  })

  it('rejects a second active invitation for the same email', async () => {
    const ctx = await createPlatformTestContext()
    expect((await invite(ctx, 'dup@example.com')).status).toBe(201)
    expect((await invite(ctx, 'DUP@example.com')).status).toBe(409)
  })

  it('expires invitations after 30 days', async () => {
    const ctx = await createPlatformTestContext()
    const { token } = await invite(ctx, 'late@example.com')
    ctx.setNow('2026-12-01T09:00:01+09:00')
    const described = await ctx.anonymous().call('GET', `/api/internal-invitation/${token}`)
    expect(await described.json()).toMatchObject({ status: 'expired' })
    expect((await ctx.anonymous().call('POST', `/api/internal-invitation/${token}/accept`, { json: NEW_USER })).status).toBe(410)
    expect((await invite(ctx, 'late@example.com')).status).toBe(201)
  })

  it('cancels a pending invitation', async () => {
    const ctx = await createPlatformTestContext()
    const { id, token } = await invite(ctx, 'cancel@example.com')
    const admin = await ctx.token(USERS.admin, CORP)
    expect((await ctx.call(admin, 'DELETE', `/api/company/${CORP}/internal-invitation/${id}/`)).status).toBe(204)
    expect((await ctx.anonymous().call('POST', `/api/internal-invitation/${token}/accept`, { json: NEW_USER })).status).toBe(410)
  })

  it('requires existing users to sign in as the invited email', async () => {
    const ctx = await createPlatformTestContext()
    const { token } = await invite(ctx, `${USERS.freeAdmin}@example.com`)
    expect((await ctx.anonymous().call('POST', `/api/internal-invitation/${token}/accept`, { json: {} })).status).toBe(401)
    const other = await ctx.login(`${USERS.individualAdmin}@example.com`)
    expect((await other.call('POST', `/api/internal-invitation/${token}/accept`, { json: {} })).status).toBe(403)
    const invitee = await ctx.login(`${USERS.freeAdmin}@example.com`)
    expect((await invitee.call('GET', '/api/member/active_invitations/')).status).toBe(200)
    expect((await invitee.call('POST', `/api/internal-invitation/${token}/accept`, { json: {} })).status).toBe(201)
  })

  it('only lets company admins invite', async () => {
    const ctx = await createPlatformTestContext()
    const member = await ctx.token(USERS.plainMember, CORP)
    const response = await ctx.call(member, 'POST', `/api/company/${CORP}/internal-invitation`, { json: { email: 'x@example.com' } })
    expect(response.status).toBe(403)
  })
})
