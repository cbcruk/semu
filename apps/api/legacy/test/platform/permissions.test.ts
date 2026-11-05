import { describe, expect, it } from 'vitest'
import { queryOne } from '../../src/db/query'
import { CORP, createPlatformTestContext, USERS } from '../helpers/test-app'

interface CatalogGroup {
  children: { code: string; is_accessible?: boolean }[]
}

function accessible(catalog: CatalogGroup[], code: string): boolean | undefined {
  return catalog.flatMap((group) => group.children).find((leaf) => leaf.code === code)?.is_accessible
}

describe('roles and permissions', () => {
  it('reflects role changes in /api/perm/menus and in API 403s', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const member = await ctx.token(USERS.plainMember, CORP)

    const before = (await (await ctx.call(member, 'GET', `/api/perm/menus?company_id=${CORP}`)).json()) as CatalogGroup[]
    expect(accessible(before, 'tax_surtax')).toBe(false)
    expect((await ctx.call(member, 'GET', `/api/company/${CORP}/integrations/v2`)).status).toBe(403)

    const role = await ctx.call(admin, 'POST', `/api/company/${CORP}/perm/role/`, { json: { name: '재무', menu_codes: ['integrate_transaction', 'tax_surtax'] } })
    expect(role.status).toBe(201)
    const { id: roleId } = (await role.json()) as { id: string }
    const granted = await ctx.call(admin, 'PUT', `/api/company/${CORP}/user/${USERS.plainMember}/permissions/`, { json: { is_admin: false, role_ids: [roleId] } })
    expect(granted.status).toBe(200)

    const after = (await (await ctx.call(member, 'GET', `/api/perm/menus?company_id=${CORP}`)).json()) as CatalogGroup[]
    expect(accessible(after, 'tax_surtax')).toBe(true)
    expect((await ctx.call(member, 'GET', `/api/company/${CORP}/integrations/v2`)).status).toBe(200)
    const menus = (await (await ctx.call(member, 'GET', `/api/company/${CORP}/user/me/menus/`)).json()) as { accessible_permissions: string[] }
    expect(menus.accessible_permissions).toEqual(expect.arrayContaining(['integrate_transaction', 'tax_surtax']))

    const members = (await (await ctx.call(admin, 'GET', `/api/company/${CORP}/perm/role/${roleId}/company-users`)).json()) as { id: string }[]
    expect(members.map((row) => row.id)).toEqual([USERS.plainMember])

    expect((await ctx.call(admin, 'DELETE', `/api/company/${CORP}/perm/role/${roleId}`)).status).toBe(204)
    expect((await ctx.call(member, 'GET', `/api/company/${CORP}/integrations/v2`)).status).toBe(403)
  })

  it('keeps at least one admin', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.individualAdmin, 'c-ind')
    const response = await ctx.call(admin, 'PUT', `/api/company/c-ind/user/${USERS.individualAdmin}/permissions`, { json: { is_admin: false, role_ids: [] } })
    expect(response.status).toBe(409)
  })

  it('stops non-admins from managing users and roles', async () => {
    const ctx = await createPlatformTestContext()
    const member = await ctx.token(USERS.taxMember, CORP)
    expect((await ctx.call(member, 'GET', `/api/company/${CORP}/user`)).status).toBe(403)
    expect((await ctx.call(member, 'POST', `/api/company/${CORP}/perm/role`, { json: { name: 'x', menu_codes: [] } })).status).toBe(403)
  })

  it('removes a user from the company', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    expect((await ctx.call(admin, 'DELETE', `/api/company/${CORP}/user/${USERS.taxMember}/`)).status).toBe(204)
    expect(queryOne(ctx.db, 'SELECT 1 AS found FROM memberships WHERE company_id = ? AND user_id = ?', [CORP, USERS.taxMember])).toBeUndefined()
    const removed = await ctx.token(USERS.taxMember, CORP)
    expect((await ctx.call(removed, 'GET', `/api/company/${CORP}/`)).status).toBe(403)
  })

  it('limits the AI assistant to system admins', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const reply = await ctx.call(admin, 'POST', `/api/company/${CORP}/ai-agent/messages`, { json: { message: '세금계산서 발행해줘' } })
    expect(reply.status).toBe(201)
    const body = (await reply.json()) as { conversation_id: string; reply: { tool_calls: { tool: string; requires_confirmation: boolean }[] } }
    expect(body.reply.tool_calls).toEqual([expect.objectContaining({ tool: 'issue_tax_invoice', requires_confirmation: true })])
    expect((await ctx.call(admin, 'GET', `/api/company/${CORP}/ai-agent/conversations/${body.conversation_id}`)).status).toBe(200)
    const member = await ctx.token(USERS.taxMember, CORP)
    expect((await ctx.call(member, 'GET', `/api/company/${CORP}/ai-agent/conversations`)).status).toBe(403)
  })

  it('recommends open grants for the company region', async () => {
    const ctx = await createPlatformTestContext()
    const admin = await ctx.token(USERS.admin, CORP)
    const body = (await (await ctx.call(admin, 'GET', `/api/company/${CORP}/grants/recommendations`)).json()) as { results: { id: string }[] }
    expect(body.results.map((grant) => grant.id)).toEqual(['g-1', 'g-2'])
  })
})

describe('subscriptions', () => {
  it('flips the plan entitlement when agency staff change a subscription', async () => {
    const ctx = await createPlatformTestContext()
    const agent = await ctx.token(USERS.agent)
    const admin = await ctx.token(USERS.admin, CORP)
    const before = (await (await ctx.call(admin, 'GET', `/api/company/${CORP}/perm/subscription/`)).json()) as { code: string; is_subscribed: boolean }[]
    expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'tax', is_subscribed: true })]))
    expect((await ctx.call(admin, 'GET', `/api/company/${CORP}/tax/calendar?year=2026`)).status).toBe(200)

    expect((await ctx.call(admin, 'PUT', `/api/company/${CORP}/perm/subscription/tax`, { json: { status: 'ended', started_on: '2026-01-01', ended_on: '2026-10-31' } })).status).toBe(403)
    const ended = await ctx.call(agent, 'PUT', `/api/company/${CORP}/perm/subscription/tax`, { json: { status: 'ended', started_on: '2026-01-01', ended_on: '2026-10-31' } })
    expect(ended.status).toBe(200)
    expect(queryOne<{ tax_plan: string | null }>(ctx.db, 'SELECT tax_plan FROM companies WHERE id = ?', [CORP])?.tax_plan).toBeNull()
    expect((await ctx.call(admin, 'GET', `/api/company/${CORP}/tax/calendar?year=2026`)).status).toBe(403)

    const payroll = await ctx.call(agent, 'PUT', `/api/company/${CORP}/perm/subscription/payroll`, { json: { status: 'active', started_on: '2026-11-01', monthly_fee: 50000 } })
    expect(payroll.status).toBe(200)
    expect(queryOne<{ has_payroll_plan: number }>(ctx.db, 'SELECT has_payroll_plan FROM companies WHERE id = ?', [CORP])?.has_payroll_plan).toBe(1)
    const proxied = (await (await ctx.call(admin, 'GET', `/nexus-api/company/${CORP}/subscriptions/`)).json()) as { code: string; is_subscribed: boolean }[]
    expect(proxied).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'payroll', is_subscribed: true })]))
  })
})
