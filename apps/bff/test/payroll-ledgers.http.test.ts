import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_REASON } from '../src/payroll/ledgers.routes.ts'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD, DEMO_USER_IDS, makeHarness } from './legacy-client.ts'
import type { Harness, HarnessOptions, LegacyClient } from './legacy-client.ts'

const PAYROLL = `/api/company/${DEMO_COMPANY_IDS.corporation}/payroll`
const KIM = 'emp_01JBQ00000000000000000D3M1'
const UNKNOWN_LEDGER = 'pyl_01JBQ000000000000000000000'
/** 현행 확정·해제는 세무 대리인만 했으므로 기본 사용자는 담당자입니다. */
const AGENT = 'agent@agency.example'

let harness: Harness
let client: LegacyClient

beforeEach(async () => {
  harness = makeHarness()
  client = harness.client()
  await client.login(AGENT)
})

afterEach(() => harness.dispose())

/** BFF로 현행 카드를 만듭니다. */
async function createCard(signedIn: LegacyClient, month: string): Promise<any> {
  const response = await signedIn.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: month } })
  expect(response.status).toBe(201)
  return response.json()
}

/** 새 API에서 대장을 바로 읽습니다. BFF가 실제로 무엇을 썼는지 확인합니다. */
async function upstreamLedger(target: Harness, id: string): Promise<any> {
  const { token } = await target.api.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.corporation })
  const response = await target.api.request('GET', `/v1/payroll-ledgers/${id}`, { token })
  return response.status === 200 ? response.json() : { status: response.status }
}

async function post(signedIn: LegacyClient, path: string, headers?: Record<string, string>) {
  return signedIn.request('POST', `${PAYROLL}/cards/${path}`, headers === undefined ? {} : { headers })
}

async function intercepted(options: HarnessOptions): Promise<{ harness: Harness; client: LegacyClient }> {
  const custom = makeHarness(options)
  const signedIn = custom.client()
  await signedIn.login(AGENT)
  return { harness: custom, client: signedIn }
}

/** 새 API의 문제 응답입니다. */
function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'Rejected', status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

const isCommand = (request: Request, name: string) =>
  request.method === 'POST' && new URL(request.url).pathname.endsWith(`:${name}`)

describe('payroll cards (급여 관리) read and create', () => {
  it('creates the regular ledger from the legacy body and answers in the legacy card shape', async () => {
    const response = await client.request('POST', `${PAYROLL}/cards/`, {
      body: { attribution_month: '2026-09', name: ' 9월 급여 ' },
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(body).toMatchObject({
      id: expect.stringMatching(/^pyl_/),
      generation: 'legacy',
      kind: 'default',
      parent_card_id: null,
      name: '9월 급여',
      title: '9월 급여',
      attribution_month: '2026-09',
      attr_date: '2026-09',
      payment_date: '2026-09-25',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      status: 'input_available',
      legacy_status: 'input_available',
      card_status: 'inputting',
      step: 1,
      step_count: 3,
      version: 1,
      approved_at: null,
      headcount: { wage_salary: 1, daily: 0, business: 0, other_labor: 0 },
      headcount_by_type: { 'wage-monthly': 1, 'wage-daily': 0, 'wage-hourly': 0, daily: 0, business: 0, other: 0 },
      total_by_type: { 'wage-monthly': { gross_pay: 3_400_000, net_pay: 3_346_950 } },
      net_pay_total_by_type: { wage_salary: 3_346_950, daily: 0, business: 0, other_labor: 0 },
      gross_total: 3_400_000,
      net_total: 3_346_950,
      uncalculated_count: 0,
      withholding_filed: false,
      daily: [],
      business: [],
      other_labor: [],
    })
    expect(body.wage_salary).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^pyr_/),
        card_id: body.id,
        income_type: 'wage-salary',
        legacy_income_type: 'wage-salary',
        wage_type: 'wage_monthly',
        employee_id: KIM,
        name: '김세무',
        resident_number: null,
        payment_date: '2026-09-25',
        base_pay: 3_400_000,
        prorate_requested: false,
        proration: null,
        payment_items: [],
        taxable_incomes: {},
        other_deductions: {},
        is_calculated: true,
        gross_pay: 3_400_000,
        income_tax: 20_410,
        local_income_tax: 2_040,
        employee_insurance_total: 30_600,
        net_pay: 3_346_950,
        calculation: expect.objectContaining({
          type: 'wage-monthly',
          income_type: 'wage_monthly',
          employment_insurance: 30_600,
          employer: expect.objectContaining({ employment_insurance: 39_100 }),
        }),
      }),
    ])
  })

  it('validates the legacy create body before calling the new API', async () => {
    const writes: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (request.method !== 'GET' && request.url.includes('/payroll-ledgers')) writes.push(request.url)
        return next(request)
      },
    })
    try {
      const cases: Array<[unknown, string]> = [
        [{}, 'attribution_month'],
        [{ attribution_month: '2026-13' }, 'attribution_month'],
        [{ attribution_month: 202609 }, 'attribution_month'],
        [{ attribution_month: '2026-09', payment_date: '25' }, 'payment_date'],
        [{ attribution_month: '2026-09', name: '   ' }, 'name'],
        [{ attribution_month: '2026-09', name: 'x'.repeat(101) }, 'name'],
        [{ attribution_month: '2026-09', name: 9 }, 'name'],
      ]
      for (const [body, field] of cases) {
        const response = await signedIn.request('POST', `${PAYROLL}/cards/`, { body })
        expect(response.status).toBe(422)
        expect(Object.keys((await response.json()).errors)).toEqual([field])
      }

      expect(writes).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('maps the new API validation of a real date back to the legacy field', async () => {
    const response = await client.request('POST', `${PAYROLL}/cards/`, {
      body: { attribution_month: '2026-09', payment_date: '2026-02-30' },
    })

    expect(response.status).toBe(422)
    expect(Object.keys((await response.json()).errors)).toEqual(['payment_date'])
  })

  it('keeps a missing rate table a 422 instead of a missing card', async () => {
    const response = await client.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: '2025-12' } })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'RATE_TABLE_NOT_FOUND', month: expect.any(String) })
  })

  it('reads one card, its status and the summary list newest month first with the year filter', async () => {
    const september = await createCard(client, '2026-09')
    const october = await createCard(client, '2026-10')
    const january = await createCard(client, '2027-01')

    const detail = await client.request('GET', `${PAYROLL}/cards/${september.id}/`)
    const status = await client.request('GET', `${PAYROLL}/cards/${september.id}/card-status/`)
    const all = await (await client.request('GET', `${PAYROLL}/card-summary/`)).json()
    const year = await (await client.request('GET', `${PAYROLL}/card-summary/?year=2026`)).json()

    expect(detail.status).toBe(200)
    expect(detail.headers.get('etag')).toBe('"1"')
    expect(await detail.json()).toEqual(september)
    expect(await status.json()).toEqual({ id: september.id, status: 'input_available', card_status: 'inputting' })
    expect(all.results.map((card: { id: string }) => card.id)).toEqual([january.id, october.id, september.id])
    expect(year.results.map((card: { id: string }) => card.id)).toEqual([october.id, september.id])
    expect(year.results[1]).toMatchObject({ headcount: { wage_salary: 1 }, net_total: 3_346_950 })
    expect(year.results[1].wage_salary).toBeUndefined()
  })

  it('rejects malformed summary queries', async () => {
    for (const query of ['year=abc', 'year=1999', 'year=', 'year=2026.5']) {
      const response = await client.request('GET', `${PAYROLL}/card-summary/?${query}`)
      expect(response.status).toBe(422)
      expect((await response.json()).errors).toEqual({ year: ['Invalid value.'] })
    }
    for (const [query, field] of [
      ['status=open', 'status'],
      ['attr_date=2026-9', 'attr_date'],
      ['fixed_cards_only=yes', 'fixed_cards_only'],
    ]) {
      const response = await client.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/?${query}`)
      expect(response.status).toBe(422)
      expect(Object.keys((await response.json()).errors)).toEqual([field])
    }
  })

  it('answers cards that are not new ledger IDs, or unknown, with the legacy 404', async () => {
    for (const id of ['123', UNKNOWN_LEDGER, KIM]) {
      const response = await client.request('GET', `${PAYROLL}/cards/${id}/`)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ detail: 'Payroll card not found.', code: 'NOT_FOUND' })
    }
  })
})

describe('payroll card lifecycle', () => {
  it('calculates, fixes and releases a card through the new commands', async () => {
    const card = await createCard(client, '2026-09')

    const calculated = await post(client, `${card.id}/calculate/`)
    const calculatedBody = await calculated.json()
    const fixed = await post(client, `${card.id}/extensions/fix/`)
    const fixedBody = await fixed.json()
    const released = await post(client, `${card.id}/extensions/release/`)
    const releasedBody = await released.json()
    const upstream = await upstreamLedger(harness, card.id)

    expect(calculated.status).toBe(200)
    expect(calculated.headers.get('etag')).toBe('"2"')
    expect(calculatedBody).toMatchObject({ status: 'calculating', card_status: 'calculated', step: 2 })
    expect(calculatedBody.wage_salary).toBeUndefined()
    expect(fixedBody).toMatchObject({ status: 'done', card_status: 'approved', approved_at: expect.any(String) })
    expect(released.status).toBe(200)
    expect(released.headers.get('etag')).toBe('"5"')
    expect(releasedBody).toMatchObject({ status: 'input_available', card_status: 'inputting', approved_at: null })
    expect(upstream).toMatchObject({ status: 'DRAFT', reopenReason: RELEASE_REASON, version: 5 })
  })

  it('releases a calculated card with one command', async () => {
    const card = await createCard(client, '2026-09')
    await post(client, `${card.id}/calculate/`)

    const released = await post(client, `${card.id}/extensions/release/`)

    expect(released.status).toBe(200)
    expect(released.headers.get('etag')).toBe('"3"')
    expect((await upstreamLedger(harness, card.id)).reopenReason).toBeNull()
  })

  it('fixes only calculated cards and releases only calculated or fixed cards, like the legacy server', async () => {
    const card = await createCard(client, '2026-09')

    const fix = await post(client, `${card.id}/extensions/fix/`)
    const release = await post(client, `${card.id}/extensions/release/`)

    expect(fix.status).toBe(409)
    expect(await fix.json()).toEqual({
      detail: 'Cannot fix a payroll card that is inputting.',
      code: 'INVALID_TRANSITION',
    })
    expect(release.status).toBe(409)
    expect((await release.json()).code).toBe('INVALID_TRANSITION')
    expect(await upstreamLedger(harness, card.id)).toMatchObject({ status: 'DRAFT', version: 1 })
  })

  it('maps the new transition rejection to the legacy code', async () => {
    const card = await createCard(client, '2026-09')
    await post(client, `${card.id}/calculate/`)

    const again = await post(client, `${card.id}/calculate/`)

    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('INVALID_TRANSITION')
  })

  it('passes If-Match through and checks its format before any call', async () => {
    const card = await createCard(client, '2026-09')

    const stale = await post(client, `${card.id}/calculate/`, { 'if-match': '"9"' })
    const malformed = await post(client, `${card.id}/calculate/`, { 'if-match': 'latest' })
    const staleRename = await client.request('PATCH', `${PAYROLL}/cards/${card.id}/update-name/`, {
      body: { name: '새 이름' },
      headers: { 'if-match': '"9"' },
    })

    expect(stale.status).toBe(412)
    expect((await stale.json()).code).toBe('VERSION_CONFLICT')
    expect(malformed.status).toBe(412)
    expect(staleRename.status).toBe(412)
    expect(await upstreamLedger(harness, card.id)).toMatchObject({ status: 'DRAFT', version: 1 })

    await post(client, `${card.id}/calculate/`, { 'if-match': '"1"' })
    const staleFix = await post(client, `${card.id}/extensions/fix/`, { 'if-match': '"1"' })
    const staleRelease = await post(client, `${card.id}/extensions/release/`, { 'if-match': '"1"' })

    expect(staleFix.status).toBe(412)
    expect(staleRelease.status).toBe(412)
    expect(await upstreamLedger(harness, card.id)).toMatchObject({ status: 'SUBMITTED', version: 2 })
  })

  it('rejects a malformed If-Match without calling the new API', async () => {
    const calls: string[] = []
    let watching = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (watching) calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return next(request)
      },
    })
    try {
      const card = await createCard(signedIn, '2026-09')
      watching = true
      const responses = [
        await post(signedIn, `${card.id}/calculate/`, { 'if-match': 'latest' }),
        await post(signedIn, `${card.id}/extensions/fix/`, { 'if-match': 'latest' }),
        await post(signedIn, `${card.id}/extensions/release/`, { 'if-match': 'latest' }),
        await signedIn.request('DELETE', `${PAYROLL}/cards/${card.id}/`, { headers: { 'if-match': 'latest' } }),
        await signedIn.request('PATCH', `${PAYROLL}/cards/${card.id}/update-name/`, {
          body: { name: '이름' },
          headers: { 'if-match': 'latest' },
        }),
      ]

      expect(responses.map((response) => response.status)).toEqual([412, 412, 412, 412, 412])
      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('sends the version it read when the legacy client sends no If-Match', async () => {
    const seen: Array<[string, string | null]> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        for (const name of ['close', 'reopen', 'return-to-draft']) {
          if (isCommand(request, name)) seen.push([name, request.headers.get('if-match')])
        }
        return next(request)
      },
    })
    try {
      const card = await createCard(signedIn, '2026-09')
      await post(signedIn, `${card.id}/calculate/`)
      await post(signedIn, `${card.id}/extensions/fix/`)
      await post(signedIn, `${card.id}/extensions/release/`)

      expect(seen).toEqual([
        ['close', '"2"'],
        ['reopen', '"3"'],
        ['return-to-draft', '"4"'],
      ])
    } finally {
      await custom.dispose()
    }
  })

  it('renames a card', async () => {
    const card = await createCard(client, '2026-09')

    const renamed = await client.request('PATCH', `${PAYROLL}/cards/${card.id}/update-name/`, {
      body: { name: ' 9월 정기 ' },
    })
    const empty = await client.request('PATCH', `${PAYROLL}/cards/${card.id}/update-name/`, { body: {} })

    expect(renamed.status).toBe(200)
    expect(renamed.headers.get('etag')).toBe('"2"')
    expect(await renamed.json()).toMatchObject({ name: '9월 정기', headcount: { wage_salary: 1 } })
    expect(empty.status).toBe(422)
    expect((await empty.json()).errors).toEqual({ name: ['This field is required.'] })
  })
})

describe('releasing a fixed card across two new API calls', () => {
  async function fixedCard(signedIn: LegacyClient): Promise<string> {
    const card = await createCard(signedIn, '2026-09')
    await post(signedIn, `${card.id}/calculate/`)
    await post(signedIn, `${card.id}/extensions/fix/`)
    return card.id
  }

  it('closes the ledger again when the new API rejects the return to input', async () => {
    const closes: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (isCommand(request, 'close')) closes.push(request.headers.get('if-match'))
        return isCommand(request, 'return-to-draft')
          ? Promise.resolve(problem(403, { code: 'PERMISSION_DENIED', permission: 'payroll-ledger:submit' }))
          : next(request)
      },
    })
    try {
      const id = await fixedCard(signedIn)
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'payroll-ledger:submit' })
      expect(await upstreamLedger(custom, id)).toMatchObject({ status: 'CLOSED', version: 5 })
      // 확정(버전 2 → 3)과 되돌리기(`:reopen` 뒤 버전 4)의 `:close`입니다. 되돌리기도 버전을 확인합니다.
      expect(closes).toEqual(['"2"', '"4"'])
    } finally {
      await custom.dispose()
    }
  })

  it('does not undo when the outcome is unknown and asks to reload', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        isCommand(request, 'return-to-draft') ? Promise.resolve(problem(503, { code: 'UNAVAILABLE' })) : next(request),
    })
    try {
      const id = await fixedCard(signedIn)
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(503)
      expect((await response.json()).code).toBe('PARTIAL_WRITE')
      expect(await upstreamLedger(custom, id)).toMatchObject({ status: 'SUBMITTED', version: 4 })
    } finally {
      await custom.dispose()
    }
  })

  it('does not undo after a timeout', async () => {
    let fixedId = ''
    const { harness: custom, client: signedIn } = await intercepted({
      timeoutMs: 50,
      intercept: async (request, next) => {
        if (fixedId !== '' && isCommand(request, 'return-to-draft')) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        return next(request)
      },
    })
    try {
      fixedId = await fixedCard(signedIn)
      const response = await post(signedIn, `${fixedId}/extensions/release/`)
      await new Promise((resolve) => setTimeout(resolve, 250))

      expect(response.status).toBe(504)
      expect((await response.json()).code).toBe('PARTIAL_WRITE')
      // 늦게 도착한 되돌리기 요청이 처리됐고, BFF는 다시 마감하지 않았습니다.
      expect(await upstreamLedger(custom, fixedId)).toMatchObject({ status: 'DRAFT' })
    } finally {
      await custom.dispose()
    }
  })

  it('propagates a session that ended instead of undoing', async () => {
    const closes: string[] = []
    let failing = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (failing && isCommand(request, 'close')) closes.push(request.url)
        if (failing && isCommand(request, 'return-to-draft')) {
          return Promise.resolve(problem(401, { code: 'UNAUTHENTICATED' }))
        }
        return next(request)
      },
    })
    try {
      const id = await fixedCard(signedIn)
      failing = true
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(401)
      expect((await response.json()).code).toBe('UNAUTHENTICATED')
      expect(closes).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('propagates a session that ended while undoing', async () => {
    let failing = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (failing && isCommand(request, 'return-to-draft')) {
          return Promise.resolve(problem(409, { code: 'PAYROLL_LEDGER_TRANSITION_INVALID' }))
        }
        if (failing && isCommand(request, 'close')) return Promise.resolve(problem(401, { code: 'UNAUTHENTICATED' }))
        return next(request)
      },
    })
    try {
      const id = await fixedCard(signedIn)
      failing = true
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(401)
    } finally {
      await custom.dispose()
    }
  })

  it('logs only the ledger ID and status and asks to reload when undoing fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let failing = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (failing && isCommand(request, 'return-to-draft')) {
          return Promise.resolve(problem(409, { code: 'PAYROLL_LEDGER_TRANSITION_INVALID' }))
        }
        if (failing && isCommand(request, 'close')) return Promise.resolve(problem(409, { code: 'X' }))
        return next(request)
      },
    })
    try {
      const id = await fixedCard(signedIn)
      failing = true
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(502)
      expect((await response.json()).code).toBe('PARTIAL_WRITE')
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('payroll ledger'), { ledgerId: id, status: 409 })
    } finally {
      errors.mockRestore()
      await custom.dispose()
    }
  })

  it('refuses to release a closed ledger of the client approval workflow before any write', async () => {
    const writes: string[] = []
    let approval = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: async (request, next) => {
        if (approval && request.method !== 'GET') writes.push(request.url)
        const response = await next(request)
        if (!approval || request.method !== 'GET' || !/\/v1\/payroll-ledgers\/pyl_[^/]+$/.test(request.url)) {
          return response
        }
        const body = { ...((await response.json()) as object), workflow: 'CLIENT_APPROVAL' }
        return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
      },
    })
    try {
      const id = await fixedCard(signedIn)
      approval = true
      const response = await post(signedIn, `${id}/extensions/release/`)

      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('INVALID_TRANSITION')
      expect(writes).toEqual([])
    } finally {
      await custom.dispose()
    }
  })
})

describe('additional cards and deletion', () => {
  it('creates an additional card under a calculated card and deletes only additional cards', async () => {
    const march = await createCard(client, '2027-03')
    const early = await post(client, `${march.id}/additional-card/`)
    await post(client, `${march.id}/calculate/`)

    const addition = await post(client, `${march.id}/additional-card/`)
    const additionBody = await addition.json()
    const summary = await (await client.request('GET', `${PAYROLL}/card-summary/`)).json()
    const deleteRegular = await client.request('DELETE', `${PAYROLL}/cards/${march.id}/`)
    const staleDelete = await client.request('DELETE', `${PAYROLL}/cards/${additionBody.id}/`, {
      headers: { 'if-match': '"7"' },
    })
    const deleted = await client.request('DELETE', `${PAYROLL}/cards/${additionBody.id}/`)

    expect(early.status).toBe(409)
    expect(await early.json()).toMatchObject({ code: 'ADDITIONAL_CARD_NOT_ALLOWED', reason: 'parent_not_calculated' })
    expect(addition.status).toBe(201)
    expect(additionBody).toMatchObject({
      kind: 'addition',
      parent_card_id: march.id,
      attribution_month: '2027-03',
      payment_date: march.payment_date,
      wage_salary: [],
    })
    expect(summary.results.map((card: any) => [card.kind, card.parent_card_id])).toEqual([
      ['addition', march.id],
      ['default', null],
    ])
    expect(deleteRegular.status).toBe(409)
    expect(await deleteRegular.json()).toEqual({
      detail: 'Only an additional payroll card can be deleted.',
      code: 'INVALID_TRANSITION',
    })
    expect(staleDelete.status).toBe(412)
    expect(deleted.status).toBe(204)
    expect(await upstreamLedger(harness, additionBody.id)).toEqual({ status: 404 })
    expect(await upstreamLedger(harness, march.id)).toMatchObject({ status: 'SUBMITTED' })
  })

  it('reads the parent of an additional card on its own detail', async () => {
    const march = await createCard(client, '2027-03')
    await post(client, `${march.id}/calculate/`)
    const addition = await (await post(client, `${march.id}/additional-card/`)).json()

    const detail = await (await client.request('GET', `${PAYROLL}/cards/${addition.id}/`)).json()

    expect(detail.parent_card_id).toBe(march.id)
  })
})

describe('fixed payrolls of a month', () => {
  it('groups by attribution month and reads the closed cards of a month', async () => {
    const september = await createCard(client, '2026-09')
    const october = await createCard(client, '2026-10')
    await post(client, `${september.id}/calculate/`)
    await post(client, `${september.id}/extensions/fix/`)

    const grouped = await (await client.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/`)).json()
    const fixedOnly = await (
      await client.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/?fixed_cards_only=true`)
    ).json()
    const inputOnly = await (
      await client.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/?status=input_available`)
    ).json()
    const oneMonth = await (
      await client.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/?attr_date=2026-09`)
    ).json()
    const detail = await (await client.request('GET', `${PAYROLL}/cards/${september.id}/?fixed_cards_only=true`)).json()
    const wage = await (
      await client.request('GET', `${PAYROLL}/cards/${september.id}/fixed-payrolls/?income_type=wage_salary`)
    ).json()
    const daily = await (
      await client.request('GET', `${PAYROLL}/cards/${september.id}/fixed-payrolls/?income_type=daily`)
    ).json()
    const unknown = await client.request('GET', `${PAYROLL}/cards/${september.id}/fixed-payrolls/?income_type=bonus`)
    const open = await (await client.request('GET', `${PAYROLL}/cards/${october.id}/fixed-payrolls/`)).json()

    expect(grouped.results).toEqual([
      expect.objectContaining({ attr_date: '2026-10', default_card: october.id, additional_count: 0 }),
      expect.objectContaining({ attr_date: '2026-09', default_card: september.id, additional_count: 0 }),
    ])
    expect(grouped.results[1].cards).toEqual([expect.objectContaining({ id: september.id, status: 'done' })])
    expect(fixedOnly.results.map((group: any) => group.attr_date)).toEqual(['2026-09'])
    expect(inputOnly.results.map((group: any) => group.attr_date)).toEqual(['2026-10'])
    expect(oneMonth.results.map((group: any) => group.attr_date)).toEqual(['2026-09'])
    expect(detail).toMatchObject({ id: september.id, card_ids: [september.id] })
    expect(detail.wage_salary).toEqual([expect.objectContaining({ card_id: september.id, name: '김세무' })])
    expect(wage.results).toEqual([expect.objectContaining({ card_id: september.id, income_type: 'wage-salary' })])
    expect(daily.results).toEqual([])
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ detail: 'Income type not found.', code: 'NOT_FOUND' })
    expect(open.results).toEqual([])
  })
})

describe('reading every ledger', () => {
  const listing = (request: Request) =>
    request.method === 'GET' && new URL(request.url).pathname === '/v1/payroll-ledgers'

  it('stops on a repeated cursor', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: async (request, next) => {
        if (!listing(request)) return next(request)
        return new Response(JSON.stringify({ items: [], nextCursor: 'again' }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    try {
      const response = await signedIn.request('GET', `${PAYROLL}/card-summary/`)

      expect(response.status).toBe(502)
      expect((await response.json()).code).toBe('UPSTREAM_CURSOR_REPEATED')
    } finally {
      await custom.dispose()
    }
  })

  it('stops after the page limit', async () => {
    let page = 0
    const { harness: custom, client: signedIn } = await intercepted({
      maxUpstreamPages: 2,
      intercept: async (request, next) => {
        if (!listing(request)) return next(request)
        page += 1
        return new Response(JSON.stringify({ items: [], nextCursor: `c${page}` }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    try {
      const response = await signedIn.request('GET', `${PAYROLL}/card-summary/`)

      expect(response.status).toBe(502)
      expect((await response.json()).code).toBe('UPSTREAM_LIST_TOO_LARGE')
      expect(page).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('follows the cursor and keeps the rows of each ledger with it', async () => {
    const cursors: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (!listing(request)) return next(request)
        const url = new URL(request.url)
        cursors.push(url.searchParams.get('cursor'))
        // 페이지를 작게 잘라 커서를 따라가게 합니다.
        url.searchParams.set('limit', '4')
        return next(new Request(url, request))
      },
    })
    try {
      const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
      for (const month of months) await createCard(signedIn, month)
      cursors.length = 0

      const body = await (await signedIn.request('GET', `${PAYROLL}/card-summary/?year=2026`)).json()

      expect(body.results.map((card: any) => card.attribution_month)).toEqual([...months].reverse())
      expect(body.results.every((card: any) => card.headcount.wage_salary === 1)).toBe(true)
      expect(cursors).toEqual([null, expect.any(String)])
    } finally {
      await custom.dispose()
    }
  })
})

describe('legacy authorization and plans', () => {
  it('keeps fix and release for agency staff and refuses company users before any call', async () => {
    const writes: string[] = []
    const { harness: custom, client: owner } = await intercepted({
      intercept: (request, next) => {
        if (isCommand(request, 'close') || isCommand(request, 'reopen') || isCommand(request, 'return-to-draft')) {
          writes.push(new URL(request.url).pathname)
        }
        return next(request)
      },
    })
    try {
      await owner.login('owner@semu.example')
      const card = await createCard(owner, '2026-09')
      const calculated = await post(owner, `${card.id}/calculate/`)
      const fix = await post(owner, `${card.id}/extensions/fix/`)
      const release = await post(owner, `${card.id}/extensions/release/`)

      expect(calculated.status).toBe(200)
      expect(fix.status).toBe(403)
      expect(await fix.json()).toEqual({
        detail: 'Only agency staff may fix a payroll card.',
        code: 'PERMISSION_DENIED',
      })
      expect(release.status).toBe(403)
      expect((await release.json()).code).toBe('PERMISSION_DENIED')
      expect(writes).toEqual([])

      const agent = custom.client()
      await agent.login(AGENT)
      const fixed = await post(agent, `${card.id}/extensions/fix/`)
      const released = await post(agent, `${card.id}/extensions/release/`)

      expect(fixed.status).toBe(200)
      expect(released.status).toBe(200)
      expect(await upstreamLedger(custom, card.id)).toMatchObject({ status: 'DRAFT' })
    } finally {
      await custom.dispose()
    }
  })

  /**
   * 담당자를 법인 회사의 관리자로 초대해 받게 하고, 법인 회사의 약관에 동의시킵니다(다른 창이라고 봅니다). 데모 시드에는
   * 대리인 계정이면서 회사 멤버인 계정이 없습니다. 멤버십이 배정보다 먼저라 담당자는 법인 회사에서 고객으로 행동하고,
   * 개인 회사에서는 여전히 대리인입니다. 약관까지 동의해야 BFF가 막지 않을 때 새 API가 `:close`를 실제로 받습니다.
   */
  async function agentJoinsCorporation(target: Harness): Promise<void> {
    const owner = await target.api.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.corporation })
    const invited = await target.api.request('POST', '/v1/invitations', {
      token: owner.token,
      body: { email: AGENT, access: 'ADMIN', roleIds: [] },
    })
    expect(invited.status).toBe(201)
    const accepted = await target.api.request('POST', '/v1/invitations:accept', {
      body: { token: await target.api.lastMailToken(), password: DEMO_PASSWORD },
    })
    expect(accepted.status).toBe(200)
    const member = await target.api.signIn(AGENT, { companyId: DEMO_COMPANY_IDS.corporation })
    const { items } = await (await target.api.request('GET', '/v1/me/term-agreements', { token: member.token })).json()
    const decisions = (items as any[])
      .filter((agreement) => agreement.status === 'REQUIRED')
      .map((agreement) => ({ termId: agreement.term.id, agreed: true }))
    const agreed = await target.api.request('POST', '/v1/me/term-agreements', {
      token: member.token,
      body: { decisions },
    })
    expect(agreed.status).toBe(200)
  }

  /** 대장 커맨드를 기록하는 하네스와, 담당자가 만들고 계산한 법인 카드입니다. */
  async function recordedCard(
    options: HarnessOptions = {},
  ): Promise<{ custom: Harness; agent: LegacyClient; cardId: string; writes: string[] }> {
    const writes: string[] = []
    const custom = makeHarness({
      ...options,
      intercept: (request, next) => {
        if (isCommand(request, 'close') || isCommand(request, 'reopen') || isCommand(request, 'return-to-draft')) {
          writes.push(new URL(request.url).pathname)
        }
        return options.intercept === undefined ? next(request) : options.intercept(request, next)
      },
    })
    const agent = custom.client()
    await agent.login(AGENT)
    const card = await createCard(agent, '2026-09')
    expect((await post(agent, `${card.id}/calculate/`)).status).toBe(200)
    return { custom, agent, cardId: card.id, writes }
  }

  async function expectRefused(signedIn: LegacyClient, cardId: string): Promise<void> {
    const fix = await post(signedIn, `${cardId}/extensions/fix/`)
    const release = await post(signedIn, `${cardId}/extensions/release/`)
    expect(fix.status).toBe(403)
    expect(await fix.json()).toEqual({ detail: 'Only agency staff may fix a payroll card.', code: 'PERMISSION_DENIED' })
    expect(release.status).toBe(403)
    expect(await release.json()).toEqual({
      detail: 'Only agency staff may release a payroll card.',
      code: 'PERMISSION_DENIED',
    })
  }

  it('refuses fix and release for an agency account that signs in as a member of the company', async () => {
    const { custom, cardId, writes } = await recordedCard()
    try {
      await agentJoinsCorporation(custom)
      const member = custom.client()
      await member.login(AGENT)

      await expectRefused(member, cardId)
      expect(writes).toEqual([])
      expect(await upstreamLedger(custom, cardId)).toMatchObject({ status: 'SUBMITTED' })
    } finally {
      await custom.dispose()
    }
  })

  it('refuses after the session that started as agency becomes a member, though the cached grant still says agency', async () => {
    // 같은 BFF 세션이 법인 회사에 대리인으로 묶인 채, 담당자가 다른 창에서 멤버가 됩니다. 초대 수락은 access token을 폐기하므로
    // 다음 호출이 401로 갱신하고, 확인은 그 새 grant(고객)로 다시 합니다. 커맨드는 새 API에 가지 않습니다.
    const { custom, agent, cardId, writes } = await recordedCard()
    try {
      await agentJoinsCorporation(custom)

      await expectRefused(agent, cardId)
      expect(writes).toEqual([])
      expect(await upstreamLedger(custom, cardId)).toMatchObject({ status: 'SUBMITTED' })
    } finally {
      await custom.dispose()
    }
  })

  it('refuses when switching from a company it serves as agency to one where it is a member', async () => {
    const { custom, agent, cardId, writes } = await recordedCard()
    try {
      // 멤버가 되기 전에 개인 회사(대리인)로 옮겨 두어, 법인 경로가 대리인 grant에서 고객 grant로 전환하게 합니다.
      expect((await agent.request('GET', `/api/company/${DEMO_COMPANY_IDS.individual}/`)).status).toBe(200)
      await agentJoinsCorporation(custom)

      await expectRefused(agent, cardId)
      expect(writes).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('lets an agency session bound to another company fix and release after switching to the card company', async () => {
    const { custom, agent, cardId } = await recordedCard()
    try {
      expect((await agent.request('GET', `/api/company/${DEMO_COMPANY_IDS.individual}/`)).status).toBe(200)
      expect((await post(agent, `${cardId}/extensions/fix/`)).status).toBe(200)

      expect((await agent.request('GET', `/api/company/${DEMO_COMPANY_IDS.individual}/`)).status).toBe(200)
      expect((await post(agent, `${cardId}/extensions/release/`)).status).toBe(200)
      expect(await upstreamLedger(custom, cardId)).toMatchObject({ status: 'DRAFT' })
    } finally {
      await custom.dispose()
    }
  })

  it('lets the agency account fix once its membership is removed, refreshing a grant that still says client', async () => {
    const { custom, cardId } = await recordedCard()
    try {
      await agentJoinsCorporation(custom)
      const member = custom.client()
      await member.login(AGENT)
      expect((await post(member, `${cardId}/extensions/fix/`)).status).toBe(403)

      const owner = await custom.api.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.corporation })
      const removed = await custom.api.request('DELETE', `/v1/users/${DEMO_USER_IDS.agent}`, { token: owner.token })
      expect(removed.status).toBe(204)

      // 세션의 grant는 아직 고객입니다. 거절하기 전에 한 번 갱신해 새 grant(대리인)로 다시 확인합니다.
      expect((await post(member, `${cardId}/extensions/fix/`)).status).toBe(200)
      expect(await upstreamLedger(custom, cardId)).toMatchObject({ status: 'CLOSED' })
    } finally {
      await custom.dispose()
    }
  })

  it('refuses a session whose grant carries no actor kind', async () => {
    const stripped = async (request: Request, next: (request: Request) => Promise<Response>) => {
      const response = await next(request)
      if (!new URL(request.url).pathname.startsWith('/v1/auth/sessions') || !response.ok) return response
      const body = (await response.json()) as any
      if (body.company !== undefined) delete body.company.actorKind
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
    }
    const { custom, cardId, writes } = await recordedCard({ intercept: stripped })
    try {
      const agent = custom.client()
      await agent.login(AGENT)

      await expectRefused(agent, cardId)
      expect(writes).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('pins the current gap: a taxation-only company cannot open the cards because the new ledgers need PAYROLL', async () => {
    // 현행 급여 관리는 기장(TAXATION) 메뉴였습니다. 새 대장은 PAYROLL만 받으므로 이 조각으로 갈아타기 전에 정해야 합니다.
    const sole = harness.client()
    await sole.login('sole@semu.example')
    const base = `/api/company/${DEMO_COMPANY_IDS.individual}/payroll`

    const summary = await sole.request('GET', `${base}/card-summary/`)
    const create = await sole.request('POST', `${base}/cards/`, { body: { attribution_month: '2026-09' } })

    for (const response of [summary, create]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', required_plans: ['PAYROLL'] })
    }
  })
})

describe('row reads of the card lists', () => {
  it('stops before reading rows of more ledgers than the cap, and the year filter keeps it under', async () => {
    const rowReads: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      maxLedgerRowReads: 2,
      intercept: (request, next) => {
        if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/rows')) rowReads.push(request.url)
        return next(request)
      },
    })
    try {
      await createCard(signedIn, '2026-09')
      await createCard(signedIn, '2026-10')
      await createCard(signedIn, '2027-01')
      rowReads.length = 0

      const all = await signedIn.request('GET', `${PAYROLL}/card-summary/`)
      const grouped = await signedIn.request('GET', `${PAYROLL}/card-summary/group-by-attr-date/`)

      expect(all.status).toBe(502)
      expect((await all.json()).code).toBe('UPSTREAM_LIST_TOO_LARGE')
      expect(grouped.status).toBe(502)
      expect(rowReads).toEqual([])

      const year = await signedIn.request('GET', `${PAYROLL}/card-summary/?year=2026`)

      expect(year.status).toBe(200)
      expect((await year.json()).results).toHaveLength(2)
    } finally {
      await custom.dispose()
    }
  })
})
