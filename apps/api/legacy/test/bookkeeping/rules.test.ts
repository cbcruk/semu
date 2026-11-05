import { beforeEach, describe, expect, it } from 'vitest'
import { queryOne } from '../../src/db/query'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const company = `/api/company/${CORP}`
const cardRule = [{ field: 'source', op: 'in', values: ['card'] }]

describe('bookkeeping classification rules', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const purchase = (id: string): { account_title_id: string | null; classified_by: string | null; classified_rule_id: string | null } | undefined =>
    queryOne(ctx.db, 'SELECT account_title_id, classified_by, classified_rule_id FROM purchase_evidence WHERE id = ?', [id])
  const apply = async (mode: 'fill_empty' | 'overwrite'): Promise<Record<string, unknown>> => {
    const response = await ctx.call(admin, 'POST', `${company}/classification-rules/apply`, { json: { scope: 'purchase', mode } })
    expect(response.status).toBe(202)
    return (await response.json()) as Record<string, unknown>
  }

  it('seeds rule classifications on the shared evidence', () => {
    expect(purchase('p-2')).toEqual({ account_title_id: 'at-sga-welfare', classified_by: 'rule', classified_rule_id: 'rule-purchase-card-welfare' })
    expect(purchase('p-1')).toMatchObject({ account_title_id: 'at-cogs-goods', classified_by: 'manual' })
  })

  it('tries rules in priority order and re-applies them after a reorder', async () => {
    const created = await ctx.call(admin, 'POST', `${company}/classification-rules`, {
      json: { scope: 'purchase', name: '카드 소모품', conditions: cardRule, result_account_title_id: 'at-sga-supplies' },
    })
    expect(created.status).toBe(201)
    const rule = (await created.json()) as { id: string; priority: number }

    const unchanged = await apply('overwrite')
    expect(unchanged).toMatchObject({ status: 'done', updated: 0 })
    expect(purchase('p-2')?.account_title_id).toBe('at-sga-welfare')

    const order = await ctx.call(admin, 'PUT', `${company}/classification-rules/order`, { json: { scope: 'purchase', ids: [rule.id, 'rule-purchase-card-welfare'] } })
    expect(order.status).toBe(200)
    expect(((await order.json()) as { id: string }[]).map((row) => row.id)).toEqual([rule.id, 'rule-purchase-card-welfare'])

    const job = await apply('overwrite')
    expect(job).toMatchObject({ status: 'done', mode: 'overwrite', updated: 2 })
    expect(purchase('p-2')).toEqual({ account_title_id: 'at-sga-supplies', classified_by: 'rule', classified_rule_id: rule.id })
    expect(purchase('p-3')?.account_title_id).toBe('at-sga-supplies')
    expect(purchase('p-1')).toMatchObject({ account_title_id: 'at-cogs-goods', classified_by: 'manual' })

    const fetched = await ctx.call(admin, 'GET', `${company}/classification-rules/apply/${String(job['job_id'])}`)
    expect(await fetched.json()).toMatchObject({ id: job['job_id'], updated: 2 })
    expect(await apply('fill_empty')).toMatchObject({ updated: 0 })
  })

  it('fills only empty rows in fill_empty mode', async () => {
    await ctx.call(admin, 'PATCH', `${company}/evidence/purchase/p-3`, { json: { account_title_id: null } })
    expect(purchase('p-3')).toEqual({ account_title_id: null, classified_by: null, classified_rule_id: null })
    expect(await apply('fill_empty')).toMatchObject({ updated: 1 })
    expect(purchase('p-3')).toMatchObject({ account_title_id: 'at-sga-welfare', classified_by: 'rule' })
  })

  it('hides a rule so it no longer classifies', async () => {
    const hidden = await ctx.call(admin, 'PATCH', `${company}/classification-rules/rule-purchase-card-welfare`, { json: { is_hidden: true } })
    expect(hidden.status).toBe(200)
    await ctx.call(admin, 'PATCH', `${company}/evidence/purchase/p-3`, { json: { account_title_id: null } })
    expect(await apply('fill_empty')).toMatchObject({ updated: 0 })
    const visible = (await (await ctx.call(admin, 'GET', `${company}/classification-rules?scope=purchase`)).json()) as unknown[]
    expect(visible).toHaveLength(0)
  })

  it('previews matches and validates conditions per scope', async () => {
    const preview = await ctx.call(admin, 'POST', `${company}/classification-rules/preview`, {
      json: { scope: 'purchase', conditions: [...cardRule, { field: 'supply_amount', op: 'lte', max: 400_000 }] },
    })
    expect(preview.status).toBe(200)
    const page = (await preview.json()) as { count: number; results: { id: string }[] }
    expect(page.count).toBe(1)
    expect(page.results.map((row) => row.id)).toEqual(['p-3'])

    const invalid = await ctx.call(admin, 'POST', `${company}/classification-rules`, {
      json: { scope: 'bank', name: '잘못된 규칙', conditions: cardRule, result_account_title_id: 'at-sga-rent' },
    })
    expect(invalid.status).toBe(422)
  })

  it('classifies bank transactions by summary', async () => {
    const rent = queryOne<{ account_title_id: string; partner_id: string; classified_by: string }>(
      ctx.db,
      "SELECT account_title_id, partner_id, classified_by FROM bank_transactions WHERE external_key = 'demo-main-1015'",
    )
    expect(rent).toEqual({ account_title_id: 'at-sga-rent', partner_id: 'pt-landlord', classified_by: 'rule' })
  })
})
