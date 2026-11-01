import { beforeAll, describe, expect, it } from 'vitest'
import { SEED } from '../src/db/seed'
import { CORP, createTestContext, type TestContext, USERS } from './helpers/test-app'

interface MenuNode {
  code: string | null
  is_promotion: boolean
  promotion_url: string | null
  children: MenuNode[]
}

function leaves(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node) => (node.children.length === 0 ? [node] : leaves(node.children)))
}

describe('access control over HTTP', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestContext()
  })

  const status = async (userId: string, companyId: string | undefined, method: string, path: string, json?: unknown): Promise<[number, string]> => {
    const response = await ctx.call(await ctx.token(userId, companyId), method, path, json === undefined ? {} : { json })
    const body = (await response.json()) as { code?: string }
    return [response.status, body.code ?? '']
  }

  it('rejects missing and invalid tokens', async () => {
    expect((await ctx.app.request(`/api/company/${CORP}/tax/surtax`)).status).toBe(401)
    const response = await ctx.call('not-a-jwt', 'GET', `/api/company/${CORP}/tax/surtax`)
    expect(response.status).toBe(401)
  })

  it('binds tokens to their company', async () => {
    expect(await status(USERS.admin, SEED.companies.free, 'GET', `/api/company/${CORP}/tax/surtax`)).toEqual([403, 'COMPANY_MISMATCH'])
  })

  it('upsells free companies with a promotion URL', async () => {
    const response = await ctx.call(await ctx.token(USERS.freeAdmin, SEED.companies.free), 'GET', `/api/company/${SEED.companies.free}/tax/surtax`)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', promotion_url: '/settings/plan/detail' })
  })

  it('distinguishes permission, applicability and consent failures', async () => {
    expect(await status(USERS.plainMember, CORP, 'GET', `/api/company/${CORP}/tax/surtax`)).toEqual([403, 'PERMISSION_DENIED'])
    expect(await status(USERS.admin, CORP, 'GET', `/api/company/${CORP}/tax/aggr-income-tax`)).toEqual([404, 'NOT_FOUND'])
    const individual = SEED.companies.individual
    expect(await status(USERS.individualAdmin, individual, 'GET', `/api/company/${individual}/tax/surtax`)).toEqual([403, 'TAX_TERMS_REQUIRED'])
    expect(await status(USERS.taxMember, CORP, 'GET', `/api/company/${CORP}/tax/surtax/`)).toEqual([200, ''])
  })

  it('keeps demo accounts read-only', async () => {
    expect((await status(USERS.demo, CORP, 'GET', `/api/company/${CORP}/tax/surtax`))[0]).toBe(200)
    expect(await status(USERS.demo, CORP, 'POST', `/api/company/${CORP}/home/action-cards/x/complete`, { completion_reason: 'done' })).toEqual([
      403,
      'DEMO_READ_ONLY',
    ])
  })

  it('scopes desk routes to agency staff and their assignments', async () => {
    const corpFiling = ctx.db.prepare("SELECT id FROM tax_filings WHERE company_id = ? AND tax_type = 'surtax' LIMIT 1").get(CORP) as { id: string }
    expect((await status(USERS.agent, undefined, 'GET', `/api/desk/filings/${corpFiling.id}`))[0]).toBe(200)
    expect((await status(USERS.manager, undefined, 'GET', `/api/desk/filings/${corpFiling.id}`))[0]).toBe(200)
    expect(await status(USERS.otherAgent, undefined, 'GET', `/api/desk/filings/${corpFiling.id}`)).toEqual([404, 'NOT_FOUND'])
    expect(await status(USERS.admin, CORP, 'GET', '/api/desk/filings')).toEqual([403, 'PERMISSION_DENIED'])
    const queue = (await (await ctx.call(await ctx.token(USERS.manager), 'GET', '/api/desk/filings?limit=2')).json()) as { count: number; next: string | null; results: unknown[] }
    expect(queue.results).toHaveLength(2)
    expect(queue.count).toBeGreaterThan(2)
    expect(queue.next).toContain('offset=2')
  })

  it('builds the menu tree with promotion nodes only for free companies', async () => {
    const free = await ctx.call(await ctx.token(USERS.freeAdmin, SEED.companies.free), 'GET', `/api/company/${SEED.companies.free}/menu/menu-tree/latest/`)
    const freeLeaves = leaves((await free.json()) as MenuNode[])
    expect(freeLeaves.find((node) => node.code === 'tax_surtax')).toMatchObject({ is_promotion: true, promotion_url: '/settings/plan/detail' })
    expect(freeLeaves.find((node) => node.code === 'tax_aggr_income')).toBeUndefined()

    const plain = await ctx.call(await ctx.token(USERS.plainMember, CORP), 'GET', `/api/company/${CORP}/menu/menu-tree/2026.08_퇴직금정산`)
    const plainCodes = leaves((await plain.json()) as MenuNode[]).map((node) => node.code)
    expect(plainCodes).toEqual(['today'])

    const admin = await ctx.call(await ctx.token(USERS.admin, CORP), 'GET', `/api/company/${CORP}/menu/menu-tree/latest`)
    const adminLeaves = leaves((await admin.json()) as MenuNode[])
    expect(adminLeaves.map((node) => node.code)).toEqual(['today', 'estimated_vat', 'tax_surtax', 'tax_withholding', 'tax_corporation', 'employee_management'])
    expect(adminLeaves.every((node) => !node.is_promotion)).toBe(true)
  })

  it('returns 404 for unknown menu tree versions so clients fall back to latest', async () => {
    expect(await status(USERS.admin, CORP, 'GET', `/api/company/${CORP}/menu/menu-tree/2099.01_unknown`)).toEqual([404, 'NOT_FOUND'])
  })

  it('accepts Django-style trailing slashes', async () => {
    expect((await status(USERS.admin, CORP, 'GET', `/api/company/${CORP}/home/action-cards/summary/`))[0]).toBe(200)
  })
})
