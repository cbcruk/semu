import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_COMPANY_IDS, makeHarness } from './legacy-client.ts'
import type { Harness, LegacyClient } from './legacy-client.ts'

const COMPANY = `/api/company/${DEMO_COMPANY_IDS.corporation}`
const WITHHOLDING = `${COMPANY}/tax/withholding-tax`
const SUMMARY = `${COMPANY}/payroll/withholding-summary`
/** 데모 법인의 10월분 원천세입니다. 자료 요청 중(`REQUESTED`)입니다. */
const OCTOBER = 'fil_01JBQ0000000000000000000D1'
/** 데모 법인의 2기 확정 부가세입니다. 원천세 경로로는 없는 신고 건입니다. */
const VAT = 'fil_01JBQ0000000000000000000D2'
const UNKNOWN = 'fil_01JBQ000000000000000000000'
const OWNER = 'owner@semu.example'
const AGENT = 'agent@agency.example'
/** 고객이 답할 원천세 제출 자료입니다. 급여대장 마감분은 자동 연계라 빠집니다. */
const CLIENT_ITEMS = [
  'business_income',
  'other_income',
  'daily_wage',
  'retirement_income',
  'interest_dividend',
  'unreflected_bonus',
]
const RETURN_FILE = 'fle_01JBQ00000000000000000RTN1'

let harness: Harness
let owner: LegacyClient

beforeEach(async () => {
  harness = makeHarness()
  owner = harness.client()
  await owner.login(OWNER)
})

afterEach(() => harness.dispose())

async function signedIn(target: Harness, email: string): Promise<LegacyClient> {
  const client = target.client()
  await client.login(email)
  return client
}

/** 새 API를 대리인으로 바로 부릅니다. 고객 화면에 없는 대리인 커맨드로 신고 건을 진행합니다. */
async function asAgent(target: Harness, method: string, path: string, body?: unknown): Promise<any> {
  const { token } = await target.api.signIn(AGENT, { companyId: DEMO_COMPANY_IDS.corporation })
  const response = await target.api.request(method, path, { token, ...(body === undefined ? {} : { body }) })
  expect(response.status).toBeLessThan(300)
  return response.json()
}

/** 고객이 답할 항목을 모두 "해당 없음"으로 답합니다. 마지막 버전을 돌려줍니다. */
async function answerAll(client: LegacyClient): Promise<number> {
  let version = 0
  for (const code of CLIENT_ITEMS) {
    const response = await client.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/${code}/`, {
      body: { response: 'not_applicable' },
    })
    expect(response.status).toBe(200)
    version = (await response.json()).version
  }
  return version
}

/** 신고 건을 신고 완료(`FILED`)까지 진행합니다. 대리인 커맨드는 새 API로 바로 보냅니다. */
async function filed(target: Harness, client: LegacyClient, payableAmount: number): Promise<number> {
  const version = await answerAll(client)
  const submitted = await client.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, {
    headers: { 'if-match': `"${version}"` },
  })
  expect(submitted.status).toBe(200)
  await asAgent(target, 'POST', `/v1/filings/${OCTOBER}:start-review`)
  await asAgent(target, 'POST', `/v1/filings/${OCTOBER}:start-preparing`)
  const filing = await asAgent(target, 'POST', `/v1/filings/${OCTOBER}:file`, {
    payableAmount,
    returnFileId: RETURN_FILE,
  })
  return filing.version
}

/** 새 API의 문제 응답입니다. */
function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'Rejected', status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

/** 새 API를 부른 기록을 남기는 하네스입니다. 로그인 호출은 지웁니다. */
async function watched(email: string): Promise<{ harness: Harness; client: LegacyClient; calls: string[] }> {
  const calls: string[] = []
  const custom = makeHarness({
    intercept: (request, next) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`)
      return next(request)
    },
  })
  const client = await signedIn(custom, email)
  calls.length = 0
  return { harness: custom, client, calls }
}

describe('withholding filings (세무 > 원천세) list and detail', () => {
  it('lists withholding filings in the legacy shape, newest period first, with the year filter and DRF page', async () => {
    const response = await owner.request('GET', `${WITHHOLDING}/`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ count: 1, next: null, previous: null })
    expect(body.results).toEqual([
      {
        id: OCTOBER,
        tax_type: 'withholding_tax',
        kind: 'monthly',
        tax_period_key: '2026-10-payment',
        revision: 0,
        year: 2026,
        quarter: 4,
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        statutory_due: '2026-11-10',
        due_date: '2026-11-10',
        payment_due: '2026-11-10',
        submit_due: '2026-11-06',
        status: 'requested',
        is_overdue: expect.any(Boolean),
        step: '자료 제출 가능',
        step_index: 1,
        step_count: 5,
        payable_amount: null,
        settlement: null,
        paid_on: null,
        ledger_dispute_count: 0,
        version: 1,
        updated_at: expect.any(String),
      },
    ])
    const other = await (await owner.request('GET', `${WITHHOLDING}/?year=2025`)).json()
    expect(other).toEqual({ count: 0, next: null, previous: null, results: [] })
    const paged = await (await owner.request('GET', `${WITHHOLDING}/?limit=1&offset=1`)).json()
    expect(paged).toMatchObject({ count: 1, results: [], previous: expect.stringContaining('offset=0') })
  })

  it('orders filings like the legacy SQL whatever order the new API gives', async () => {
    const custom = makeHarness({
      intercept: async (request, next) => {
        const url = new URL(request.url)
        if (request.method !== 'GET' || url.pathname !== '/v1/filings') return next(request)
        const page: any = await (await next(request)).json()
        const [october] = page.items
        const items = [
          { ...october, id: 'fil_01JBQ0000000000000000000S1', periodStart: '2026-09-01', periodEnd: '2026-09-30' },
          october,
          { ...october, id: 'fil_01JBQ0000000000000000000R1', revision: 1 },
          { ...october, id: 'fil_01JBQ0000000000000000000A0' },
        ]
        return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } })
      },
    })
    try {
      const client = await signedIn(custom, OWNER)
      const body = await (await client.request('GET', `${WITHHOLDING}/`)).json()
      expect(body.results.map((item: { id: string }) => item.id)).toEqual([
        'fil_01JBQ0000000000000000000R1',
        'fil_01JBQ0000000000000000000A0',
        OCTOBER,
        'fil_01JBQ0000000000000000000S1',
      ])
    } finally {
      await custom.dispose()
    }
  })

  it('rejects a malformed year before calling the new API', async () => {
    const { harness: custom, client, calls } = await watched(OWNER)
    try {
      for (const query of ['year=abc', 'year=1999', 'year=', 'year=2026.5']) {
        const response = await client.request('GET', `${WITHHOLDING}/?${query}`)
        expect(response.status).toBe(422)
        expect(Object.keys((await response.json()).errors)).toEqual(['year'])
      }
      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('reads one filing with labelled requirements, visible documents and the timeline', async () => {
    const response = await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(body).toMatchObject({ id: OCTOBER, status: 'requested', documents: [], timeline: [] })
    expect(body.requirements.map((item: { code: string }) => item.code)).toEqual([
      'payroll_ledger_closed',
      ...CLIENT_ITEMS,
    ])
    expect(body.requirements[0]).toEqual({
      code: 'payroll_ledger_closed',
      label: '급여대장 마감분',
      response: 'pending',
      auto_linked: true,
      linked_status: 'open',
      note: null,
      updated_at: null,
      files: [],
    })
    expect(body.requirements[1]).toMatchObject({
      code: 'business_income',
      label: '사업소득(프리랜서·용역비) 지급 내역',
      auto_linked: false,
      linked_status: null,
    })
  })

  it('answers 404 for another tax type, an unknown filing and a non-filing ID without calling for the last', async () => {
    const vat = await owner.request('GET', `${WITHHOLDING}/${VAT}/`)
    const unknown = await owner.request('GET', `${WITHHOLDING}/${UNKNOWN}/`)
    expect([vat.status, unknown.status]).toEqual([404, 404])
    expect(await vat.json()).toEqual({ detail: 'Filing not found.', code: 'NOT_FOUND' })
    expect(await unknown.json()).toEqual({ detail: 'Filing not found.', code: 'NOT_FOUND' })
    // 부가세 신고 건에 원천세 경로로 보낸 전이도 새 커맨드에 닿기 전에 404입니다.
    const submitVat = await owner.request('POST', `${WITHHOLDING}/${VAT}/submit/`, { headers: { 'if-match': '"1"' } })
    expect(submitVat.status).toBe(404)

    const { harness: custom, client, calls } = await watched(OWNER)
    try {
      for (const id of ['12', '3f0c2b1e-0000-4000-8000-000000000000', 'pyl_01JBQ000000000000000000000']) {
        expect((await client.request('GET', `${WITHHOLDING}/${id}/`)).status).toBe(404)
      }
      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('keeps the routes of other tax types and of files on the legacy 404 until they move', async () => {
    for (const path of [
      `${COMPANY}/tax/surtax/`,
      `${COMPANY}/tax/calendar/?year=2026`,
      `${WITHHOLDING}/${OCTOBER}/documents/fdc_01JBQ000000000000000000000/`,
      `${WITHHOLDING}/${OCTOBER}/requirements/business_income/files/${RETURN_FILE}/`,
    ]) {
      const response = await owner.request('GET', path)
      expect(response.status).toBe(404)
    }
    const upload = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/requirements/business_income/files/`, {
      body: {},
    })
    expect(upload.status).toBe(404)
  })

  it('keeps the plan and terms gates of the legacy menu', async () => {
    const free = await owner.request('GET', `/api/company/${DEMO_COMPANY_IDS.free}/tax/withholding-tax/`)
    expect(free.status).toBe(403)
    expect(await free.json()).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      required_plans: ['TAXATION'],
      promotion_url: null,
    })

    const sole = await signedIn(harness, 'sole@semu.example')
    const terms = await sole.request('GET', `/api/company/${DEMO_COMPANY_IDS.individual}/tax/withholding-tax/`)
    expect(terms.status).toBe(403)
    expect((await terms.json()).code).toBe('TAX_TERMS_REQUIRED')
  })
})

describe('withholding requirements and transitions', () => {
  it('answers a requirement and returns the list shape with the new version', async () => {
    const response = await owner.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/business_income/`, {
      body: { response: 'not_applicable', note: '프리랜서 지급 없음', ignored: true },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"2"')
    expect(body).toMatchObject({ id: OCTOBER, status: 'requested', version: 2 })
    expect(body.requirements).toBeUndefined()
    const detail = await (await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()
    expect(detail.requirements[1]).toMatchObject({
      code: 'business_income',
      response: 'not_applicable',
      note: '프리랜서 지급 없음',
    })
    expect(detail.timeline).toEqual([
      expect.objectContaining({
        type: 'requirement_answered',
        actor_type: 'client',
        from_status: null,
        to_status: null,
        payload: expect.objectContaining({ code: 'business_income' }),
      }),
    ])
  })

  it('keeps the stored note when the legacy body leaves it out or sends null, like the legacy COALESCE', async () => {
    const path = `${WITHHOLDING}/${OCTOBER}/requirements/business_income/`
    const note = async () =>
      (await (await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()).requirements[1].note

    await owner.request('PUT', path, { body: { response: 'not_applicable', note: 'keep me' } })
    expect((await owner.request('PUT', path, { body: { response: 'pending', note: null } })).status).toBe(200)
    expect(await note()).toBe('keep me')
    expect((await owner.request('PUT', path, { body: { response: 'not_applicable' } })).status).toBe(200)
    expect(await note()).toBe('keep me')
    await owner.request('PUT', path, { body: { response: 'not_applicable', note: '바꾼 메모' } })
    expect(await note()).toBe('바꾼 메모')
  })

  it('validates the body before reading the filing and refuses codes the legacy screen did not have', async () => {
    const { harness: custom, client, calls } = await watched(OWNER)
    try {
      const cases: Array<[unknown, string]> = [
        [{}, 'response'],
        [{ response: 'provided' }, 'response'],
        [{ response: 'NOT_APPLICABLE' }, 'response'],
        [{ response: 'pending', note: 3 }, 'note'],
        [{ response: 'pending', note: 'x'.repeat(1001) }, 'note'],
      ]
      for (const [body, field] of cases) {
        const response = await client.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/business_income/`, {
          body,
        })
        expect(response.status).toBe(422)
        expect(Object.keys((await response.json()).errors)).toEqual([field])
      }
      expect(calls).toEqual([])

      for (const code of ['BUSINESS_INCOME', 'pg_online_sales', 'unknown']) {
        const response = await client.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/${code}/`, {
          body: { response: 'pending' },
        })
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ detail: 'Requirement not found.', code: 'NOT_FOUND' })
      }
      expect(calls.filter((call) => call.startsWith('PATCH'))).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('maps the requirement rules of the new API to the legacy errors', async () => {
    const linked = await owner.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/payroll_ledger_closed/`, {
      body: { response: 'not_applicable' },
    })
    expect(linked.status).toBe(422)
    expect(await linked.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: { code: ['This item is linked automatically and cannot be edited.'] },
    })

    const vat = await owner.request('PUT', `${WITHHOLDING}/${VAT}/requirements/business_income/`, {
      body: { response: 'pending' },
    })
    expect(vat.status).toBe(404)

    const version = await answerAll(owner)
    await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, { headers: { 'if-match': `"${version}"` } })
    const locked = await owner.request('PUT', `${WITHHOLDING}/${OCTOBER}/requirements/business_income/`, {
      body: { response: 'pending' },
    })
    expect(locked.status).toBe(409)
    expect(await locked.json()).toEqual({
      detail: 'The filing is submitted and does not allow this action.',
      code: 'INVALID_TRANSITION',
    })
  })

  it('requires a well-formed If-Match before anything else on transitions', async () => {
    const { harness: custom, client, calls } = await watched(OWNER)
    try {
      for (const command of ['submit', 'unsubmit', 'pay']) {
        const missing = await client.request('POST', `${WITHHOLDING}/${OCTOBER}/${command}/`, {
          body: { paid_on: '2026-11-10' },
        })
        expect(missing.status).toBe(428)
        expect(await missing.json()).toEqual({
          detail: 'Send If-Match with the filing version.',
          code: 'PRECONDITION_REQUIRED',
        })
        const malformed = await client.request('POST', `${WITHHOLDING}/${OCTOBER}/${command}/`, {
          headers: { 'if-match': 'latest' },
          body: { paid_on: '2026-11-10' },
        })
        expect(malformed.status).toBe(412)
        expect((await malformed.json()).code).toBe('VERSION_CONFLICT')
      }
      for (const body of [{}, { paid_on: '10/11/2026' }, { paid_on: 20261110 }]) {
        const response = await client.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
          headers: { 'if-match': '"1"' },
          body,
        })
        expect(response.status).toBe(422)
        expect(Object.keys((await response.json()).errors)).toEqual(['paid_on'])
      }
      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('submits and unsubmits with the version and maps the pending items, stale version and wrong state', async () => {
    const pending = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, { headers: { 'if-match': '"1"' } })
    expect(pending.status).toBe(422)
    expect(await pending.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: { requirements: ['Answer every requirement item before submitting.'] },
    })

    const version = await answerAll(owner)
    const stale = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, { headers: { 'if-match': '"1"' } })
    expect(stale.status).toBe(412)
    expect(await stale.json()).toMatchObject({
      detail: 'The filing was changed by someone else. Reload and try again.',
      code: 'VERSION_CONFLICT',
    })

    const submitted = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, {
      headers: { 'if-match': `"${version}"` },
    })
    expect(submitted.status).toBe(200)
    expect(submitted.headers.get('etag')).toBe(`"${version + 1}"`)
    expect(await submitted.json()).toMatchObject({
      status: 'submitted',
      step: '자료 검토중',
      step_index: 2,
      version: version + 1,
    })

    const again = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, {
      headers: { 'if-match': `"${version + 1}"` },
    })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({
      detail: 'The filing is submitted and does not allow this action.',
      code: 'INVALID_TRANSITION',
    })

    const unsubmitted = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/unsubmit/`, {
      headers: { 'if-match': `"${version + 1}"` },
    })
    expect(unsubmitted.status).toBe(200)
    expect(await unsubmitted.json()).toMatchObject({ status: 'requested', step_index: 1, version: version + 2 })

    const timeline = (await (await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()).timeline
    expect(timeline.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'submit',
        actor_type: 'client',
        from_status: 'requested',
        to_status: 'submitted',
      }),
      expect.objectContaining({ type: 'unsubmit', from_status: 'submitted', to_status: 'requested', payload: null }),
    ])
  })

  it('lets agency staff answer, submit, unsubmit and pay for the client and shows them as agency in the timeline', async () => {
    const agent = await signedIn(harness, AGENT)
    const answered = await answerAll(agent)

    const submitted = await agent.request('POST', `${WITHHOLDING}/${OCTOBER}/submit/`, {
      headers: { 'if-match': `"${answered}"` },
    })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ status: 'submitted', version: answered + 1 })
    const unsubmitted = await agent.request('POST', `${WITHHOLDING}/${OCTOBER}/unsubmit/`, {
      headers: { 'if-match': `"${answered + 1}"` },
    })
    expect(unsubmitted.status).toBe(200)
    expect(await unsubmitted.json()).toMatchObject({ status: 'requested', version: answered + 2 })

    const version = await filed(harness, owner, 120_000)
    const paid = await agent.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
      headers: { 'if-match': `"${version}"` },
      body: { paid_on: '2026-11-10' },
    })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ status: 'settled', settlement: 'paid', paid_on: '2026-11-10' })

    const timeline = (await (await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()).timeline
    const byType = (type: string) => timeline.filter((event: { type: string }) => event.type === type)
    expect(byType('requirement_answered').slice(0, CLIENT_ITEMS.length)).toEqual(
      CLIENT_ITEMS.map(() => expect.objectContaining({ actor_type: 'agency' })),
    )
    expect(byType('submit').map((event: { actor_type: string }) => event.actor_type)).toEqual(['agency', 'client'])
    expect(byType('unsubmit')).toEqual([
      expect.objectContaining({
        actor_type: 'agency',
        from_status: 'submitted',
        to_status: 'requested',
        payload: null,
      }),
    ])
    expect(byType('pay')).toEqual([
      expect.objectContaining({ actor_type: 'agency', to_status: 'settled', payload: { paid_on: '2026-11-10' } }),
    ])
  })

  it('shows agency staff the client view of documents, like the legacy client path', async () => {
    await filed(harness, owner, 120_000)
    await asAgent(harness, 'POST', `/v1/filings/${OCTOBER}/documents`, {
      type: 'RETURN',
      fileId: 'fle_01JBQ00000000000000000RTN2',
    })
    const agent = await signedIn(harness, AGENT)

    const seen = await Promise.all(
      [agent, owner].map(async (client) => (await client.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()),
    )

    for (const body of seen) {
      expect(body.documents).toEqual([expect.objectContaining({ doc_type: 'return', replaced_at: null })])
      expect(body.timeline.at(-1)).toMatchObject({
        type: 'document_uploaded',
        actor_type: 'agency',
        payload: { doc_type: 'return', file_id: 'fle_01JBQ00000000000000000RTN2' },
      })
    }
    expect(seen[0].documents[0].id).toBe(seen[1].documents[0].id)
  })

  it('pays a filed return, shows the return document and the agency steps, and refuses a refund', async () => {
    const version = await filed(harness, owner, 120_000)

    const detail = await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)
    const body = await detail.json()
    expect(detail.headers.get('etag')).toBe(`"${version}"`)
    expect(body).toMatchObject({ status: 'filed', step: '납부', step_index: 4, payable_amount: 120_000 })
    expect(body.documents).toEqual([
      {
        id: expect.stringMatching(/^fdc_/),
        doc_type: 'return',
        original_name: null,
        mime_type: null,
        size_bytes: null,
        created_at: expect.any(String),
        first_viewed_at: null,
        replaced_at: null,
      },
    ])
    expect(body.timeline.slice(-3)).toEqual([
      expect.objectContaining({ type: 'startReview', actor_type: 'agency' }),
      expect.objectContaining({ type: 'startPreparing', actor_type: 'agency' }),
      expect.objectContaining({
        type: 'file',
        to_status: 'filed',
        payload: { payable_amount: 120_000, return_file_id: RETURN_FILE },
      }),
    ])

    const paid = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
      headers: { 'if-match': `"${version}"` },
      body: { paid_on: '2026-11-10' },
    })
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({
      status: 'settled',
      step: '마감',
      step_index: 5,
      settlement: 'paid',
      paid_on: '2026-11-10',
    })

    const fresh = makeHarness()
    try {
      const client = await signedIn(fresh, OWNER)
      const refundVersion = await filed(fresh, client, -50_000)
      const refund = await client.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
        headers: { 'if-match': `"${refundVersion}"` },
        body: { paid_on: '2026-11-10' },
      })
      expect(refund.status).toBe(409)
      expect(await refund.json()).toEqual({
        detail: 'The filing is filed and does not allow this action.',
        code: 'INVALID_TRANSITION',
      })
    } finally {
      await fresh.dispose()
    }
  })

  it('maps a date the new API rejects back to the legacy field', async () => {
    const version = await filed(harness, owner, 120_000)
    const response = await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
      headers: { 'if-match': `"${version}"` },
      body: { paid_on: '2026-02-30' },
    })

    expect(response.status).toBe(422)
    expect(Object.keys((await response.json()).errors)).toEqual(['paid_on'])
  })
})

describe('withholding summary (급여 → 원천세)', () => {
  /** BFF로 귀속월 카드를 만들고 계산 확정·확정까지 합니다. 지급일은 기본값(그달 25일)입니다. */
  async function closedCard(
    client: LegacyClient,
    month: string,
    options: { paymentDate?: string; before?: (cardId: string) => Promise<void> } = {},
  ): Promise<string> {
    const created = await client.request('POST', `${COMPANY}/payroll/cards/`, {
      body: {
        attribution_month: month,
        ...(options.paymentDate === undefined ? {} : { payment_date: options.paymentDate }),
      },
    })
    const card = await created.json()
    await options.before?.(card.id)
    expect((await client.request('POST', `${COMPANY}/payroll/cards/${card.id}/calculate/`)).status).toBe(200)
    expect((await client.request('POST', `${COMPANY}/payroll/cards/${card.id}/extensions/fix/`)).status).toBe(200)
    return card.id
  }

  it('aggregates the closed ledgers of the payment month with the covering filing for agency staff', async () => {
    const agent = await signedIn(harness, AGENT)
    const cardId = await closedCard(agent, '2026-10')

    const response = await agent.request('GET', `${SUMMARY}/2026-10/`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      payment_month: '2026-10',
      ledger_closed: true,
      open_card_ids: [],
      closed_card_ids: [cardId],
      filing: { id: OCTOBER, status: 'requested', tax_period_key: '2026-10-payment' },
      lines: [
        {
          code: 'A01',
          label: '근로소득 간이세액',
          headcount: 1,
          total_paid: 3_400_000,
          taxable_paid: expect.any(Number),
          income_tax: 20_410,
          local_income_tax: 2_040,
          verified: false,
        },
        {
          code: 'A21',
          label: '퇴직소득',
          headcount: null,
          total_paid: null,
          taxable_paid: null,
          income_tax: null,
          local_income_tax: null,
          verified: false,
        },
        expect.objectContaining({ code: 'A03', headcount: 0, total_paid: 0 }),
        expect.objectContaining({ code: 'A25', headcount: 0 }),
        expect.objectContaining({ code: 'A40', headcount: 0 }),
      ],
      totals: { headcount: 1, total_paid: 3_400_000, income_tax: 20_410, local_income_tax: 2_040 },
      verified: false,
    })

    // 지급월 마감 이벤트로 새 API가 원천세의 급여대장 마감분을 맞춥니다.
    const filing = await (await owner.request('GET', `${WITHHOLDING}/${OCTOBER}/`)).json()
    expect(filing.requirements[0]).toMatchObject({ code: 'payroll_ledger_closed', linked_status: 'closed' })
  })

  it('counts each person once per line across ledgers and rows without an employee', async () => {
    const agent = await signedIn(harness, AGENT)
    const { token } = await harness.api.signIn(OWNER, { companyId: DEMO_COMPANY_IDS.corporation })
    const addBusiness = async (ledgerId: string, payeeName: string) => {
      const response = await harness.api.request('POST', `/v1/payroll-ledgers/${ledgerId}/rows`, {
        token,
        body: { payeeName, input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
      })
      expect(response.status).toBe(201)
    }
    // 9월 귀속 카드를 10월에 지급해 김세무의 근로 행이 같은 지급월에 둘입니다.
    const september = await closedCard(agent, '2026-09', {
      paymentDate: '2026-10-05',
      before: async (id) => {
        await addBusiness(id, '박프리')
        await addBusiness(id, '박프리')
        await addBusiness(id, '최프리')
      },
    })
    const october = await closedCard(agent, '2026-10')

    const body = await (await agent.request('GET', `${SUMMARY}/2026-10/`)).json()

    expect(body.closed_card_ids).toEqual([september, october].sort())
    const line = (code: string) => body.lines.find((item: { code: string }) => item.code === code)
    expect(line('A01')).toMatchObject({ headcount: 1 })
    expect(line('A01').total_paid).toBeGreaterThan(3_400_000)
    expect(line('A25')).toMatchObject({ headcount: 2, total_paid: 3_000_000 })
    expect(body.totals.headcount).toBe(3)
  })

  it('falls back to no filing when the company has no taxation plan, like the legacy summary', async () => {
    const custom = makeHarness({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname === '/v1/filings'
          ? Promise.resolve(problem(403, { code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] }))
          : next(request),
    })
    try {
      const agent = await signedIn(custom, AGENT)
      const response = await agent.request('GET', `${SUMMARY}/2026-10/`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ payment_month: '2026-10', filing: null })
    } finally {
      await custom.dispose()
    }

    const denied = makeHarness({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname === '/v1/filings'
          ? Promise.resolve(problem(403, { code: 'PERMISSION_DENIED' }))
          : next(request),
    })
    try {
      const agent = await signedIn(denied, AGENT)
      expect((await agent.request('GET', `${SUMMARY}/2026-10/`)).status).toBe(403)
    } finally {
      await denied.dispose()
    }
  })

  it('checks the actor again on every ledger and row call with the grant that sends it', async () => {
    for (const target of ['/v1/payroll-ledgers', '/rows']) {
      let armed = false
      let refused = false
      let resent = 0
      const custom = makeHarness({
        intercept: async (request, next) => {
          const path = new URL(request.url).pathname
          if (refused && request.method === 'GET' && path.endsWith(target)) resent += 1
          // 그 호출의 토큰을 한 번 폐기하고, 갱신한 grant에서는 고객으로 행동하게 합니다.
          if (armed && !refused && request.method === 'GET' && path.endsWith(target)) {
            refused = true
            return problem(401, { code: 'UNAUTHENTICATED' })
          }
          const response = await next(request)
          if (!refused || path !== '/v1/auth/sessions:refresh') return response
          const grant: any = await response.json()
          const headers = new Headers(response.headers)
          headers.delete('content-length')
          return new Response(JSON.stringify({ ...grant, company: { ...grant.company, actorKind: 'CLIENT' } }), {
            status: response.status,
            headers,
          })
        },
      })
      try {
        const agent = await signedIn(custom, AGENT)
        await closedCard(agent, '2026-10')
        armed = true
        const response = await agent.request('GET', `${SUMMARY}/2026-10/`)
        expect(refused).toBe(true)
        // 고객 grant로는 같은 호출을 다시 보내지 않습니다.
        expect(resent).toBe(0)
        expect(response.status).toBe(403)
        expect((await response.json()).code).toBe('PERMISSION_DENIED')
      } finally {
        await custom.dispose()
      }
    }
  })

  it('lists open ledgers and counts no rows of them, and answers an empty month', async () => {
    const agent = await signedIn(harness, AGENT)
    const created = await (
      await agent.request('POST', `${COMPANY}/payroll/cards/`, { body: { attribution_month: '2026-10' } })
    ).json()

    const open = await (await agent.request('GET', `${SUMMARY}/2026-10/`)).json()
    expect(open).toMatchObject({
      ledger_closed: false,
      open_card_ids: [created.id],
      closed_card_ids: [],
      totals: { headcount: 0, total_paid: 0 },
    })

    const empty = await (await agent.request('GET', `${SUMMARY}/2027-03/`)).json()
    expect(empty).toMatchObject({ ledger_closed: false, open_card_ids: [], closed_card_ids: [], filing: null })
  })

  it('refuses clients before reading anything and before checking the month, like the legacy route', async () => {
    const { harness: custom, client, calls } = await watched(OWNER)
    try {
      for (const month of ['2026-10', '2026-13']) {
        const response = await client.request('GET', `${SUMMARY}/${month}/`)
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
          detail: 'Only agency staff can read the withholding summary.',
          code: 'PERMISSION_DENIED',
        })
      }
      // 거절 전에 한 번 갱신해 새 grant로 다시 봅니다. 새 API의 업무 경로는 부르지 않습니다.
      expect(calls.filter((call) => !call.startsWith('POST /v1/auth/'))).toEqual([])
    } finally {
      await custom.dispose()
    }

    const { harness: other, client: agent, calls: agentCalls } = await watched(AGENT)
    try {
      const invalid = await agent.request('GET', `${SUMMARY}/2026-13/`)
      expect(invalid.status).toBe(404)
      expect(await invalid.json()).toEqual({ detail: 'Payment month not found.', code: 'NOT_FOUND' })
      // 잘못된 지급월은 새 API의 업무 경로를 읽지 않습니다.
      expect(agentCalls.filter((call) => !call.startsWith('POST /v1/auth/'))).toEqual([])
    } finally {
      await other.dispose()
    }
  })

  it('switches to the path company before judging the actor on an invalid month', async () => {
    const { harness: custom, client: agent, calls } = await watched(AGENT)
    try {
      // 세션은 법인에 묶여 있습니다. 개인 회사 경로면 그 회사로 전환한 grant로 보고, 업무 경로는 읽지 않습니다.
      const other = await agent.request(
        'GET',
        `/api/company/${DEMO_COMPANY_IDS.individual}/payroll/withholding-summary/2026-13/`,
      )
      expect(other.status).toBe(404)
      expect(await other.json()).toEqual({ detail: 'Payment month not found.', code: 'NOT_FOUND' })
      expect(calls).toEqual(['POST /v1/auth/sessions:switch-company'])

      // 담당하지 않는 회사는 전환이 거절되어 지급월을 보기 전에 회사 404입니다.
      const unassigned = await agent.request(
        'GET',
        `/api/company/${DEMO_COMPANY_IDS.free}/payroll/withholding-summary/2026-13/`,
      )
      expect(unassigned.status).toBe(404)
      expect(await unassigned.json()).toEqual({ detail: 'Company not found.', code: 'NOT_FOUND' })
    } finally {
      await custom.dispose()
    }
  })

  it('pins the current plan gap: a taxation-only company has no summary because ledgers need PAYROLL', async () => {
    const agent = await signedIn(harness, AGENT)
    const response = await agent.request(
      'GET',
      `/api/company/${DEMO_COMPANY_IDS.individual}/payroll/withholding-summary/2026-10/`,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', required_plans: ['PAYROLL'] })
  })

  it('stops reading an endless or repeating filing cursor', async () => {
    for (const [cursor, code] of [
      [() => `c${Math.random()}`, 'UPSTREAM_LIST_TOO_LARGE'],
      [() => 'same', 'UPSTREAM_CURSOR_REPEATED'],
    ] as const) {
      const custom = makeHarness({
        maxUpstreamPages: 3,
        intercept: async (request, next) => {
          const url = new URL(request.url)
          if (request.method !== 'GET' || url.pathname !== '/v1/filings') return next(request)
          return new Response(JSON.stringify({ items: [], nextCursor: cursor() }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      })
      try {
        const client = await signedIn(custom, OWNER)
        const response = await client.request('GET', `${WITHHOLDING}/`)
        expect(response.status).toBe(502)
        expect((await response.json()).code).toBe(code)
      } finally {
        await custom.dispose()
      }
    }
  })

  it('never logs pay or tax amounts', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    )
    try {
      const agent = await signedIn(harness, AGENT)
      await closedCard(agent, '2026-10')
      await agent.request('GET', `${SUMMARY}/2026-10/`)
      const version = await filed(harness, owner, 120_000)
      await owner.request('POST', `${WITHHOLDING}/${OCTOBER}/pay/`, {
        headers: { 'if-match': `"${version}"` },
        body: { paid_on: '2026-11-10' },
      })

      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
      for (const secret of ['3400000', '20410', '120000']) expect(logged).not.toContain(secret)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
