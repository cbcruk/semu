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

describe('GET /v1/evidence', () => {
  it('lists one side newest first with derived amounts', async () => {
    const items = await list('side=SALES')

    const dates = items.map((row) => row.writtenOn)
    expect(dates).toEqual(['2026-10-22', '2026-10-20', '2026-10-20', '2026-10-13', '2026-10-12', '2026-10-05'])
    const card = items.find((row) => row.source === 'CARD' && row.amounts.totalAmount === 11_000_000)!
    expect(card.amounts).toEqual({ supplyAmount: 10_000_000, vatAmount: 1_000_000, totalAmount: 11_000_000 })
    expect(card.vatEstimated).toBe(true)
    expect(card.classification).toMatchObject({ status: 'CLASSIFIED', method: 'RULE' })
  })

  it('filters by classification status and pages with a cursor', async () => {
    const first = await app.send('GET', '/v1/evidence?side=SALES&classification=UNCLASSIFIED&limit=1')
    const page = (await first.json()) as { items: EvidenceBody[]; nextCursor: string }
    const second = await app.send(
      'GET',
      `/v1/evidence?side=SALES&classification=UNCLASSIFIED&limit=1&cursor=${page.nextCursor}`,
    )

    expect(page.items.map((row) => row.source)).toEqual(['MALL'])
    expect(((await second.json()) as { items: EvidenceBody[] }).items.map((row) => row.source)).toEqual(['DELIVERY'])
  })

  it('links the counterparty business number to an existing partner on ingestion', async () => {
    const [invoice] = await list('side=PURCHASE&source=TAX_INVOICE')

    expect(invoice?.partnerId).toBe('ptn_01JBQ000000000000000000002')
  })
})

describe('GET /v1/evidence:count', () => {
  it('counts classified and unclassified rows for the tabs', async () => {
    const response = await app.send('GET', '/v1/evidence:count?side=SALES')

    expect(await response.json()).toEqual({ totalCount: 6, classifiedCount: 4, unclassifiedCount: 2 })
  })
})

describe('POST /v1/evidence/{id}:classify', () => {
  it('classifies manually and bumps the version', async () => {
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

  it('refuses an account title outside the sales scope', async () => {
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

  it('refuses a group heading that has sub-accounts', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('sales') },
    })

    expect(await response.json()).toMatchObject({ reason: 'NOT_SELECTABLE' })
  })

  it('answers 412 for a stale version', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: null },
      headers: { 'if-match': '"99"' },
    })

    expect(response.status).toBe(412)
  })

  it('needs evidence:classify', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('POST', `/v1/evidence/${mall!.id}:classify`, {
      body: { accountTitleId: null },
      token: 'reader',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'evidence:classify' })
  })
})

describe('POST /v1/evidence:batchClassify', () => {
  it('classifies every row or none', async () => {
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

describe('PATCH /v1/evidence/{id}', () => {
  it('sets the VAT deduction of purchase evidence', async () => {
    const [card] = await list('side=PURCHASE&source=CARD')
    const response = await app.send('PATCH', `/v1/evidence/${card!.id}`, { body: { vatDeduction: 'DEDUCTIBLE' } })

    expect(await response.json()).toMatchObject({ vatDeduction: 'DEDUCTIBLE' })
  })

  it('refuses a VAT deduction on sales evidence', async () => {
    const [mall] = await list('side=SALES&source=MALL')
    const response = await app.send('PATCH', `/v1/evidence/${mall!.id}`, { body: { vatDeduction: 'DEDUCTIBLE' } })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'VAT_DEDUCTION_NOT_APPLICABLE' })
  })

  it('answers 404 for another company', async () => {
    const response = await app.send('GET', '/v1/evidence/evd_01JBQ000000000000000000099')

    expect(response.status).toBe(404)
  })
})
