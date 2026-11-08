import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { systemAccountTitleIdOf } from '../account-titles/system-account-titles.ts'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

const MALL_RULE = {
  scope: 'SALES',
  source: 'MALL',
  name: '쇼핑몰 매출',
  conditions: [{ field: 'TOTAL_AMOUNT', operator: 'GTE', min: 0 }],
  resultAccountTitleId: systemAccountTitleIdOf('sales.revenue'),
}

describe('자동분류 규칙 /v1/classification-rules', () => {
  it('규칙 범위의 규칙을 우선순위 순으로 보여 줍니다', async () => {
    const response = await app.send('GET', '/v1/classification-rules?scope=BANK')

    const { items } = (await response.json()) as { items: Array<{ name: string; priority: number }> }
    expect(items.map((row) => row.name)).toEqual(['에코프로 입금', '임대료', '급여'])
  })

  it('잘못된 조건을 한 번에 모두 알려 줍니다', async () => {
    const response = await app.send('POST', '/v1/classification-rules', {
      body: {
        ...MALL_RULE,
        scope: 'BANK',
        conditions: [
          { field: 'ITEM', operator: 'CONTAINS', values: ['a'] },
          { field: 'AMOUNT', operator: 'BETWEEN', min: 10, max: 1 },
        ],
      },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'CLASSIFICATION_RULE_INVALID',
      violations: [
        { index: 0, code: 'FIELD_NOT_ALLOWED' },
        { index: 1, code: 'RANGE_REVERSED' },
        { index: -1, code: 'SOURCE_NOT_ALLOWED' },
      ],
    })
  })

  it('규칙을 만들고 이미 들어온 행에 작업으로 적용합니다', async () => {
    const created = await app.send('POST', '/v1/classification-rules', { body: MALL_RULE })
    const rule = (await created.json()) as { id: string }
    const job = await app.send('POST', `/v1/classification-rules/${rule.id}:apply`, { body: { mode: 'FILL_EMPTY' } })
    const evidence = await app.send('GET', '/v1/evidence?side=SALES&source=MALL')

    expect(created.status).toBe(201)
    expect(rule).toMatchObject({ priority: 6, status: 'ACTIVE' })
    expect(job.status).toBe(202)
    expect(await job.json()).toMatchObject({ status: 'SUCCEEDED', result: { examinedCount: 6, updatedCount: 1 } })
    expect(((await evidence.json()) as { items: unknown[] }).items[0]).toMatchObject({
      classification: { method: 'RULE', ruleId: rule.id },
    })
  })

  it('덮어쓰기에서도 사람이 직접 분류한 행은 그대로 둡니다', async () => {
    const created = await app.send('POST', '/v1/classification-rules', {
      body: { ...MALL_RULE, source: 'TAX_INVOICE', resultAccountTitleId: systemAccountTitleIdOf('non_op_income.misc') },
    })
    const rule = (await created.json()) as { id: string }
    const job = await app.send('POST', `/v1/classification-rules/${rule.id}:apply`, { body: { mode: 'OVERWRITE' } })

    expect(await job.json()).toMatchObject({ result: { updatedCount: 0 } })
  })

  it('범위의 모든 규칙을 한 번씩 보낼 때만 순서를 바꿉니다', async () => {
    const listed = await app.send('GET', '/v1/classification-rules?scope=BANK')
    const ids = ((await listed.json()) as { items: Array<{ id: string }> }).items.map((row) => row.id)
    const refused = await app.send('POST', '/v1/classification-rules:reorder', {
      body: { scope: 'BANK', ruleIds: ids.slice(1) },
    })
    const reordered = await app.send('POST', '/v1/classification-rules:reorder', {
      body: { scope: 'BANK', ruleIds: [...ids].reverse() },
    })

    expect(refused.status).toBe(422)
    expect(((await reordered.json()) as { items: Array<{ name: string }> }).items.map((row) => row.name)).toEqual([
      '급여',
      '임대료',
      '에코프로 입금',
    ])
  })

  it('규칙을 PATCH로 숨기고 지울 수 있습니다', async () => {
    const listed = await app.send('GET', '/v1/classification-rules?scope=SALES')
    const [rule] = ((await listed.json()) as { items: Array<{ id: string }> }).items
    const hidden = await app.send('PATCH', `/v1/classification-rules/${rule!.id}`, { body: { status: 'HIDDEN' } })
    const visible = await app.send('GET', '/v1/classification-rules?scope=SALES')
    const deleted = await app.send('DELETE', `/v1/classification-rules/${rule!.id}`)

    expect(await hidden.json()).toMatchObject({ status: 'HIDDEN', version: 2 })
    expect(((await visible.json()) as { items: unknown[] }).items).toEqual([])
    expect(deleted.status).toBe(204)
  })
})
