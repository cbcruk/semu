import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testActor } from '../../identity-access/testing.ts'
import { systemAccountTitleIdOf } from '../account-titles/system-account-titles.ts'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'

let app: TestApp
beforeEach(() => {
  app = testApp({ reader: testActor({ permissions: new Set(['evidence:read']) }) })
})
afterEach(() => app.dispose())

interface EvidenceBody {
  id: string
  source: string
  side: string
  writtenOn: string
  amounts: { supplyAmount: number; vatAmount: number; totalAmount: number }
  vatEstimated: boolean
  classification: { status: string; accountTitleId: string | null; method: string | null }
  partnerId: string | null
  version: number
}

async function list(query: string): Promise<EvidenceBody[]> {
  const response = await app.send('GET', `/v1/evidence?${query}`)
  return ((await response.json()) as { items: EvidenceBody[] }).items
}

describe('증빙 조회 GET /v1/evidence', () => {
  it('매출·매입 한쪽을 최신순으로, 채운 금액과 함께 보여 줍니다', async () => {
    const items = await list('side=SALES')

    const dates = items.map((row) => row.writtenOn)
    expect(dates).toEqual(['2026-10-22', '2026-10-20', '2026-10-20', '2026-10-13', '2026-10-12', '2026-10-05'])
    const card = items.find((row) => row.source === 'CARD' && row.amounts.totalAmount === 11_000_000)!
    expect(card.amounts).toEqual({ supplyAmount: 10_000_000, vatAmount: 1_000_000, totalAmount: 11_000_000 })
    expect(card.vatEstimated).toBe(true)
    expect(card.classification).toMatchObject({ status: 'CLASSIFIED', method: 'RULE' })
  })

  it('분류 여부로 거르고 커서로 나눠 보여 줍니다', async () => {
    const first = await app.send('GET', '/v1/evidence?side=SALES&classification=UNCLASSIFIED&limit=1')
    const page = (await first.json()) as { items: EvidenceBody[]; nextCursor: string }
    const second = await app.send(
      'GET',
      `/v1/evidence?side=SALES&classification=UNCLASSIFIED&limit=1&cursor=${page.nextCursor}`,
    )

    expect(page.items.map((row) => row.source)).toEqual(['MALL'])
    expect(((await second.json()) as { items: EvidenceBody[] }).items.map((row) => row.source)).toEqual(['DELIVERY'])
  })

  it('받을 때 상대방 사업자번호가 같은 거래처에 연결합니다', async () => {
    const [invoice] = await list('side=PURCHASE&source=TAX_INVOICE')

    expect(invoice?.partnerId).toBe('ptn_01JBQ000000000000000000002')
  })
})

describe('증빙 건수 GET /v1/evidence:count', () => {
  it('탭에 쓸 분류·미분류 건수를 셉니다', async () => {
    const response = await app.send('GET', '/v1/evidence:count?side=SALES')

    expect(await response.json()).toEqual({ totalCount: 6, classifiedCount: 4, unclassifiedCount: 2 })
  })
})

describe('증빙 분류 POST /v1/evidence/{id}:classify', () => {
  it('직접 분류하면 버전을 올립니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('sales.revenue') },
      headers: { 'if-match': `"${mall!.version}"` },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${mall!.version + 1}"`)
    expect(await response.json()).toMatchObject({
      classification: { status: 'CLASSIFIED', method: 'MANUAL', ruleId: null },
    })
  })

  it('매출에 쓰지 않는 계정과목은 거절합니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('sga.salary') },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      type: 'urn:semu:problem:account-title-not-assignable',
      title: 'Account title cannot be used here',
      status: 422,
      code: 'ACCOUNT_TITLE_NOT_ASSIGNABLE',
      reason: 'SCOPE_MISMATCH',
      scope: 'SALES',
    })
  })

  it('하위 계정이 있는 그룹 계정은 거절합니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('sales') },
    })

    expect(await response.json()).toMatchObject({ reason: 'NOT_SELECTABLE' })
  })

  it('지난 버전으로 고치면 412입니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: null },
      headers: { 'if-match': '"99"' },
    })

    expect(response.status).toBe(412)
  })

  it('evidence:classify 권한이 있어야 합니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: null },
      token: 'reader',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'evidence:classify' })
  })
})

describe('증빙 일괄 분류 POST /v1/evidence:batchClassify', () => {
  it('모든 행을 분류하거나 하나도 분류하지 않습니다', async () => {
    const unclassified = await list('side=SALES&classification=UNCLASSIFIED')
    const missing = 'evd_01JBQ000000000000000000099'
    const refused = await app.send('POST', '/v1/evidence:batchClassify', {
      body: { evidenceIds: [...unclassified.map((row) => row.id), missing], accountTitleId: null },
    })
    const done = await app.send('POST', '/v1/evidence:batchClassify', {
      body: { evidenceIds: unclassified.map((row) => row.id), accountTitleId: systemAccountTitleIdOf('sales.revenue') },
    })

    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ code: 'BATCH_TARGET_MISSING', missingIds: [missing] })
    expect(await done.json()).toEqual({ updatedCount: 2 })
    expect(await list('side=SALES&classification=UNCLASSIFIED')).toEqual([])
  })
})

describe('증빙 수정 PATCH /v1/evidence/{id}', () => {
  it('매입 증빙의 부가세 공제 여부를 정합니다', async () => {
    const [card] = await list('side=PURCHASE&source=CARD')
    const response = await app.send('PATCH', `/v1/evidence/${card!.id}`, { body: { vatDeduction: 'DEDUCTIBLE' } })

    expect(await response.json()).toMatchObject({ vatDeduction: 'DEDUCTIBLE' })
  })

  it('매출 증빙에는 부가세 공제 여부를 정할 수 없습니다', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('PATCH', `/v1/evidence/${mall!.id}`, { body: { vatDeduction: 'DEDUCTIBLE' } })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'VAT_DEDUCTION_NOT_APPLICABLE' })
  })

  it('다른 회사의 증빙은 404입니다', async () => {
    const response = await app.send('GET', '/v1/evidence/evd_01JBQ000000000000000000099')

    expect(response.status).toBe(404)
  })
})
