import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_COMPANY_IDS, makeHarness } from './legacy-client.ts'
import type { Harness, HarnessOptions, LegacyClient } from './legacy-client.ts'

const PAYROLL = `/api/company/${DEMO_COMPANY_IDS.corporation}/payroll`
const KIM = 'emp_01JBQ00000000000000000D3M1'
const KIM_EMAIL = 'kim@example.com'
const UNKNOWN_LEDGER = 'pyl_01JBQ000000000000000000000'
const UNKNOWN_ROW = 'pyr_01JBQ000000000000000000000'
/** 현행 확정은 세무 대리인만 했으므로 카드를 확정하는 사용자는 담당자입니다. */
const AGENT = 'agent@agency.example'
const OWNER = 'owner@semu.example'

let harness: Harness
let client: LegacyClient

beforeEach(async () => {
  harness = makeHarness()
  client = harness.client()
  await client.login(AGENT)
})

afterEach(() => harness.dispose())

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

const isSend = (request: Request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/payslips:send'

async function ownerToken(target: Harness): Promise<string> {
  return (await target.api.signIn(OWNER, { companyId: DEMO_COMPANY_IDS.corporation })).token
}

/** 새 API에서 대장의 명세서를 바로 읽습니다. BFF가 실제로 몇 번 보냈는지 확인합니다. */
async function upstreamPayslips(target: Harness, ledgerId: string): Promise<any[]> {
  const response = await target.api.request('GET', `/v1/payslips?ledgerId=${ledgerId}`, {
    token: await ownerToken(target),
  })
  return (await response.json()).items
}

/** 새 API로 사업소득 행(직원이 아닌 소득자, 이메일 없음)을 더합니다. */
async function addBusinessRow(target: Harness, ledgerId: string): Promise<string> {
  const response = await target.api.request('POST', `/v1/payroll-ledgers/${ledgerId}/rows`, {
    token: await ownerToken(target),
    body: { payeeName: '박프리', input: { incomeType: 'BUSINESS', payAmount: 1_000_000 } },
  })
  expect(response.status).toBe(201)
  return (await response.json()).id
}

/** BFF로 카드를 만들고 계산 확정·확정합니다. 근로 행(김세무) ID도 돌려줍니다. */
async function closedCard(
  signedIn: LegacyClient,
  options: { month?: string; before?: (cardId: string) => Promise<void> } = {},
): Promise<{ cardId: string; wageRowId: string }> {
  const created = await signedIn.request('POST', `${PAYROLL}/cards/`, {
    body: { attribution_month: options.month ?? '2026-09' },
  })
  expect(created.status).toBe(201)
  const card = await created.json()
  await options.before?.(card.id)
  expect((await signedIn.request('POST', `${PAYROLL}/cards/${card.id}/calculate/`)).status).toBe(200)
  expect((await signedIn.request('POST', `${PAYROLL}/cards/${card.id}/extensions/fix/`)).status).toBe(200)
  return { cardId: card.id, wageRowId: card.wage_salary[0].id }
}

function sendRows(signedIn: LegacyClient, cardId: string, rowIds: unknown, headers?: Record<string, string>) {
  return signedIn.request('POST', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`, {
    body: { row_ids: rowIds },
    ...(headers === undefined ? {} : { headers }),
  })
}

describe('payslip screen reads (급여명세서)', () => {
  it('shows the wage rows of a closed card with the HR email the new API sends to', async () => {
    const { cardId, wageRowId } = await closedCard(client)

    const response = await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)
    const body = await response.json()
    const notifications = await (
      await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`)
    ).json()

    expect(response.status).toBe(200)
    expect(body.card).toMatchObject({ id: cardId, status: 'done', card_status: 'approved', net_total: 3_346_950 })
    expect(body.wage_salary).toEqual([
      expect.objectContaining({
        id: wageRowId,
        card_id: cardId,
        employee_id: KIM,
        name: '김세무',
        resident_number: null,
        net_pay: 3_346_950,
        email: KIM_EMAIL,
        payslip_email: KIM_EMAIL,
        payment_formulas: {},
        notification_status: null,
      }),
    ])
    expect(notifications).toEqual({
      results: [{ row_id: wageRowId, name: '김세무', status: null, fail_reason: null, sent_at: null }],
    })
  })

  it('does not ask the new API for payslips of a card that is not closed', async () => {
    const reads: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (new URL(request.url).pathname.startsWith('/v1/payslips')) reads.push(request.url)
        return next(request)
      },
    })
    try {
      const card = await (
        await signedIn.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: '2026-09' } })
      ).json()

      const screen = await (await signedIn.request('GET', `${PAYROLL}/cards/${card.id}/payslip/`)).json()
      const notifications = await (
        await signedIn.request('GET', `${PAYROLL}/cards/${card.id}/payslip/wage-salary/notifications/`)
      ).json()
      const send = await sendRows(signedIn, card.id, [card.wage_salary[0].id])

      expect(screen.card.card_status).toBe('inputting')
      expect(screen.wage_salary).toEqual([
        expect.objectContaining({ payslip_email: KIM_EMAIL, notification_status: null }),
      ])
      expect(notifications.results).toEqual([expect.objectContaining({ status: null, sent_at: null })])
      expect(send.status).toBe(409)
      expect(await send.json()).toEqual({
        detail: 'Payslips are available once the payroll card is approved.',
        code: 'INVALID_TRANSITION',
      })
      expect(reads).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('reads the parent of an additional card and no employees when it has no wage rows', async () => {
    const employeeReads: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (new URL(request.url).pathname === '/v1/employees') employeeReads.push(request.url)
        return next(request)
      },
    })
    try {
      const march = await (
        await signedIn.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: '2027-03' } })
      ).json()
      await signedIn.request('POST', `${PAYROLL}/cards/${march.id}/calculate/`)
      const addition = await (await signedIn.request('POST', `${PAYROLL}/cards/${march.id}/additional-card/`)).json()

      const screen = await (await signedIn.request('GET', `${PAYROLL}/cards/${addition.id}/payslip/`)).json()

      expect(screen.card).toMatchObject({ id: addition.id, kind: 'addition', parent_card_id: march.id })
      expect(screen.wage_salary).toEqual([])
      expect(employeeReads).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('does not hide other failures of the employee read', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname === '/v1/employees'
          ? Promise.resolve(problem(403, { code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] }))
          : next(request),
    })
    try {
      const { cardId } = await closedCard(signedIn)

      const response = await signedIn.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)

      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('ENTITLEMENT_REQUIRED')
    } finally {
      await custom.dispose()
    }
  })

  it('leaves the email empty for a user who may not read employees', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname === '/v1/employees'
          ? Promise.resolve(problem(403, { code: 'PERMISSION_DENIED', permission: 'employee:read' }))
          : next(request),
    })
    try {
      const { cardId } = await closedCard(signedIn)

      const response = await signedIn.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)

      expect(response.status).toBe(200)
      expect((await response.json()).wage_salary).toEqual([
        expect.objectContaining({ email: null, payslip_email: null }),
      ])
    } finally {
      await custom.dispose()
    }
  })

  it('answers cards that are not new ledger IDs, or unknown, with the legacy 404 on every payslip route', async () => {
    for (const id of ['123', UNKNOWN_LEDGER]) {
      const responses = [
        await client.request('GET', `${PAYROLL}/cards/${id}/payslip/`),
        await client.request('POST', `${PAYROLL}/cards/${id}/payslip/`, { body: { wage_salary: [] } }),
        await client.request('GET', `${PAYROLL}/cards/${id}/payslip/wage-salary/notifications/`),
        await sendRows(client, id, [UNKNOWN_ROW]),
        await client.request('POST', `${PAYROLL}/cards/${id}/payslip/wage-salary/copy-payment-formulas/`),
      ]
      for (const response of responses) {
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ detail: 'Payroll card not found.', code: 'NOT_FOUND' })
      }
    }
  })
})

describe('sending payslips', () => {
  it('sends through the new API and reports the legacy statuses, keeping the card closed', async () => {
    const { cardId, wageRowId } = await closedCard(client)

    const sent = await sendRows(client, cardId, [wageRowId])
    const notifications = await (
      await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`)
    ).json()
    const screen = await (await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)).json()

    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ results: [{ row_id: wageRowId, status: 'success', fail_reason: null }] })
    expect(notifications.results).toEqual([
      { row_id: wageRowId, name: '김세무', status: 'success', fail_reason: null, sent_at: expect.any(String) },
    ])
    expect(screen.wage_salary[0].notification_status).toBe('success')
    expect(screen.card.card_status).toBe('approved')
    expect((await upstreamPayslips(harness, cardId))[0].delivery).toMatchObject({ status: 'SENT', attempts: 1 })
  })

  it('sends any row of the card in card order and fails a payee without an email', async () => {
    let businessRowId = ''
    const { cardId, wageRowId } = await closedCard(client, {
      before: async (id) => void (businessRowId = await addBusinessRow(harness, id)),
    })

    const sent = await sendRows(client, cardId, [businessRowId, wageRowId, wageRowId])
    const notifications = await (
      await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`)
    ).json()
    const screen = await (await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)).json()

    expect(sent.status).toBe(200)
    expect((await sent.json()).results).toEqual([
      { row_id: wageRowId, status: 'success', fail_reason: null },
      { row_id: businessRowId, status: 'fail', fail_reason: 'no_email' },
    ])
    // 현행 명세서 화면과 발송 현황은 근로소득 행만입니다.
    expect(notifications.results.map((entry: any) => entry.row_id)).toEqual([wageRowId])
    expect(screen.wage_salary.map((row: any) => row.id)).toEqual([wageRowId])
    expect(screen.card.headcount).toMatchObject({ wage_salary: 1, business: 1 })
  })

  it('reports a rejected last attempt as a failure without a sent time', async () => {
    let rejected = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: async (request, next) => {
        const response = await next(request)
        if (!rejected || request.method !== 'GET' || new URL(request.url).pathname !== '/v1/payslips') return response
        // 메일 연동 가짜는 거절하지 않으므로, 성공 뒤 거절된 재발송을 새 API 응답으로 흉내 냅니다.
        const body = (await response.json()) as { items: any[] }
        for (const item of body.items) {
          item.delivery = {
            status: 'FAILED',
            failureReason: 'REJECTED',
            attemptedAt: item.delivery.attemptedAt,
            attempts: 2,
          }
        }
        return new Response(JSON.stringify(body), { status: response.status, headers: response.headers })
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)
      await sendRows(signedIn, cardId, [wageRowId])
      rejected = true

      const notifications = await (
        await signedIn.request('GET', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`)
      ).json()
      const screen = await (await signedIn.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)).json()

      expect(notifications.results).toEqual([
        { row_id: wageRowId, name: '김세무', status: 'fail', fail_reason: 'rejected', sent_at: null },
      ])
      expect(screen.wage_salary[0].notification_status).toBe('fail')
    } finally {
      await custom.dispose()
    }
  })

  it('lets company users send, unlike fixing a card', async () => {
    const { cardId, wageRowId } = await closedCard(client)
    const owner = harness.client()
    await owner.login(OWNER)

    const sent = await sendRows(owner, cardId, [wageRowId])

    expect(sent.status).toBe(200)
    expect((await sent.json()).results[0].status).toBe('success')
  })

  it('validates the legacy body before calling the new API', async () => {
    const calls: string[] = []
    let watching = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (watching) calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return next(request)
      },
    })
    try {
      const { cardId } = await closedCard(signedIn)
      watching = true
      const cases: Array<[unknown, string, string]> = [
        [undefined, 'row_ids', 'This field is required.'],
        ['pyr_x', 'row_ids', 'Expected a list.'],
        [[], 'row_ids', 'Ensure this list has 1 to 500 items.'],
        [Array.from({ length: 501 }, () => UNKNOWN_ROW), 'row_ids', 'Ensure this list has 1 to 500 items.'],
        [[UNKNOWN_ROW, 7], 'row_ids.1', 'Invalid value.'],
      ]
      for (const [rowIds, field, message] of cases) {
        const response = await sendRows(signedIn, cardId, rowIds)
        expect(response.status).toBe(422)
        expect((await response.json()).errors).toEqual({ [field]: [message] })
      }

      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('checks the card and its state before the row IDs, like the legacy server, without reading payslips', async () => {
    const calls: string[] = []
    let watching = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (watching) calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return next(request)
      },
    })
    try {
      const { cardId } = await closedCard(signedIn)
      const draft = await (
        await signedIn.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: '2026-10' } })
      ).json()
      watching = true

      const unknown = await sendRows(signedIn, UNKNOWN_LEDGER, ['123'])
      const open = await sendRows(signedIn, draft.id, ['123'])
      const closed = await sendRows(signedIn, cardId, ['123'])

      expect(unknown.status).toBe(404)
      expect(open.status).toBe(409)
      expect(closed.status).toBe(422)
      expect((await closed.json()).errors).toEqual({ row_ids: ['Some rows are not on this payroll card.'] })
      expect(calls.filter((call) => !call.startsWith('GET /v1/payroll-ledgers/'))).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('refuses rows that are not on the card before sending anything', async () => {
    const sends: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (isSend(request)) sends.push(request.url)
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await sendRows(signedIn, cardId, [wageRowId, UNKNOWN_ROW])

      expect(response.status).toBe(422)
      expect((await response.json()).errors).toEqual({ row_ids: ['Some rows are not on this payroll card.'] })
      expect(sends).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('answers the legacy 409 when the card was reopened before the send reached the new API', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        isSend(request) ? Promise.resolve(problem(404, { code: 'PAYSLIP_NOT_FOUND' })) : next(request),
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await sendRows(signedIn, cardId, [wageRowId])

      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('INVALID_TRANSITION')
    } finally {
      await custom.dispose()
    }
  })

  it('opens payslips to a taxation-only company, like the legacy payroll_management menu', async () => {
    // 2026-11-07에 새 명세서를 급여대장과 같이 PAYROLL 또는 TAXATION에 열기로 정했습니다.
    const base = `/api/company/${DEMO_COMPANY_IDS.individual}/payroll`
    const created = await client.request('POST', `${base}/cards/`, { body: { attribution_month: '2026-09' } })
    expect(created.status).toBe(201)
    const card = await created.json()
    expect((await client.request('POST', `${base}/cards/${card.id}/calculate/`)).status).toBe(200)
    expect((await client.request('POST', `${base}/cards/${card.id}/extensions/fix/`)).status).toBe(200)

    const screen = await client.request('GET', `${base}/cards/${card.id}/payslip/`)

    expect(screen.status).toBe(200)
  })
})

describe('sending payslips only once', () => {
  async function watched(options: Omit<HarnessOptions, 'intercept'> & { delaySend?: () => number } = {}) {
    const keys: Array<string | null> = []
    const { delaySend, ...rest } = options
    const custom = await intercepted({
      ...rest,
      intercept: async (request, next) => {
        if (isSend(request)) {
          keys.push(request.headers.get('idempotency-key'))
          const delay = delaySend?.() ?? 0
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        }
        return next(request)
      },
    })
    return { ...custom, keys }
  }

  it('replays a double submit instead of sending twice, and sends again after the replay window', async () => {
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const [first, second] = await Promise.all([
        sendRows(signedIn, cardId, [wageRowId]),
        sendRows(signedIn, cardId, [wageRowId]),
      ])
      const third = await sendRows(signedIn, cardId, [wageRowId])

      expect([first.status, second.status, third.status]).toEqual([200, 200, 200])
      expect((await second.json()).results).toEqual((await first.json()).results)
      expect(keys).toHaveLength(3)
      expect(new Set(keys).size).toBe(1)
      expect(keys[0]).toMatch(/^bff-payslip-send:/)
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)

      custom.advance(61_000)
      const later = await sendRows(signedIn, cardId, [wageRowId])

      expect(later.status).toBe(200)
      expect(keys[3]).not.toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('uses a new key for a different set of rows', async () => {
    let businessRowId = ''
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn, {
        before: async (id) => void (businessRowId = await addBusinessRow(custom, id)),
      })

      await sendRows(signedIn, cardId, [wageRowId])
      await sendRows(signedIn, cardId, [wageRowId, businessRowId])
      await sendRows(signedIn, cardId, [businessRowId, wageRowId])

      expect(keys[0]).not.toBe(keys[1])
      expect(keys[2]).toBe(keys[1])
      expect((await upstreamPayslips(custom, cardId)).map((item) => item.delivery.attempts)).toEqual([2, 1])
    } finally {
      await custom.dispose()
    }
  })

  it('does not share keys between sessions', async () => {
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)
      const other = custom.client()
      await other.login(AGENT)

      await sendRows(signedIn, cardId, [wageRowId])
      await sendRows(other, cardId, [wageRowId])

      expect(keys[0]).not.toBe(keys[1])
    } finally {
      await custom.dispose()
    }
  })

  it('keeps the key when a retry follows an upstream timeout', async () => {
    let slow = true
    const {
      harness: custom,
      client: signedIn,
      keys,
    } = await watched({
      sendTimeoutMs: 100,
      delaySend: () => (slow ? 300 : 0),
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const timedOut = await sendRows(signedIn, cardId, [wageRowId])
      // 늦은 첫 발송이 새 API에서 끝날 때까지 기다립니다.
      await new Promise((resolve) => setTimeout(resolve, 350))
      slow = false
      const retried = await sendRows(signedIn, cardId, [wageRowId])

      expect(timedOut.status).toBe(504)
      expect(retried.status).toBe(200)
      expect(keys[1]).toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)
    } finally {
      await custom.dispose()
    }
  })

  it('resends with the same key after the new API refused an expired token', async () => {
    let refused = false
    const keys: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (!isSend(request)) return next(request)
        keys.push(request.headers.get('idempotency-key'))
        if (refused) return next(request)
        refused = true
        return Promise.resolve(problem(401, { code: 'UNAUTHENTICATED' }))
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await sendRows(signedIn, cardId, [wageRowId])

      expect(response.status).toBe(200)
      expect(keys).toHaveLength(2)
      expect(keys[1]).toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)
    } finally {
      await custom.dispose()
    }
  })

  it('binds a client Idempotency-Key to the session and the payslips', async () => {
    let businessRowId = ''
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn, {
        before: async (id) => void (businessRowId = await addBusinessRow(custom, id)),
      })
      const owner = custom.client()
      await owner.login(OWNER)

      const first = await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-1' })
      const again = await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-1' })
      // 다른 사용자가 같은 키로 다른 행을 보냅니다. 새 API는 키를 회사 단위로만 보므로 그대로 넘기면 앞 작업이 돌아옵니다.
      const other = await sendRows(owner, cardId, [businessRowId], { 'idempotency-key': 'send-1' })

      expect(await again.json()).toEqual(await first.json())
      expect((await other.json()).results).toEqual([{ row_id: businessRowId, status: 'fail', fail_reason: 'no_email' }])
      expect(keys[0]).toMatch(/^bff-client:[0-9a-f]{64}$/)
      expect(keys[1]).toBe(keys[0])
      expect(keys[2]).not.toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId)).map((item) => item.delivery.attempts)).toEqual([1, 1])
    } finally {
      await custom.dispose()
    }
  })

  it('sends a double submit with a client key once, one request at a time', async () => {
    const keys: Array<string | null> = []
    let inFlight = 0
    let mostInFlight = 0
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: async (request, next) => {
        if (!isSend(request)) return next(request)
        keys.push(request.headers.get('idempotency-key'))
        inFlight += 1
        mostInFlight = Math.max(mostInFlight, inFlight)
        try {
          // 새 API가 메일을 보내는 동안 다음 요청이 겹치는지 봅니다. 새 API는 키를 처리 뒤에 기억합니다.
          await new Promise((resolve) => setTimeout(resolve, 50))
          return await next(request)
        } finally {
          inFlight -= 1
        }
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const responses = await Promise.all([
        sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-2' }),
        sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-2' }),
      ])

      expect(responses.map((response) => response.status)).toEqual([200, 200])
      expect(keys).toHaveLength(2)
      expect(new Set(keys).size).toBe(1)
      expect(mostInFlight).toBe(1)
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)
    } finally {
      await custom.dispose()
    }
  })

  it('binds a client key to the session: same key and payslips from another session send again', async () => {
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)
      const other = custom.client()
      await other.login(AGENT)

      await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-3' })
      await sendRows(other, cardId, [wageRowId], { 'idempotency-key': 'send-3' })

      expect(keys[1]).not.toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('binds a client key to the payslips: same session and key with other payslips sends both', async () => {
    let businessRowId = ''
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn, {
        before: async (id) => void (businessRowId = await addBusinessRow(custom, id)),
      })

      const first = await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-4' })
      const second = await sendRows(signedIn, cardId, [businessRowId], { 'idempotency-key': 'send-4' })

      expect([first.status, second.status]).toEqual([200, 200])
      expect((await second.json()).results).toEqual([
        { row_id: businessRowId, status: 'fail', fail_reason: 'no_email' },
      ])
      expect(keys[1]).not.toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId)).map((item) => item.delivery.attempts)).toEqual([1, 1])
    } finally {
      await custom.dispose()
    }
  })

  it('binds a client key to the key itself: another key for the same payslips sends again', async () => {
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-5' })
      await sendRows(signedIn, cardId, [wageRowId], { 'idempotency-key': 'send-6' })

      expect(keys[1]).not.toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('keeps the key for a day after an interrupted send, but only the window after a clear refusal', async () => {
    let failWith: number | undefined
    const keys: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (!isSend(request)) return next(request)
        keys.push(request.headers.get('idempotency-key'))
        const status = failWith
        failWith = undefined
        if (status === 503) return Promise.resolve(problem(503, { code: 'PAYSLIP_SEND_INTERRUPTED' }))
        if (status === 404) return Promise.resolve(problem(404, { code: 'PAYSLIP_NOT_FOUND' }))
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      failWith = 503
      expect((await sendRows(signedIn, cardId, [wageRowId])).status).toBe(503)
      custom.advance(5 * 60_000)
      expect((await sendRows(signedIn, cardId, [wageRowId])).status).toBe(200)

      custom.advance(61_000)
      failWith = 404
      expect((await sendRows(signedIn, cardId, [wageRowId])).status).toBe(409)
      custom.advance(61_000)
      await sendRows(signedIn, cardId, [wageRowId])

      expect(keys[1]).toBe(keys[0])
      expect(keys[2]).not.toBe(keys[1])
      expect(keys[3]).not.toBe(keys[2])
    } finally {
      await custom.dispose()
    }
  })

  it('keeps the key for a day when the new API is still sending the earlier request', async () => {
    let inProgress = false
    const keys: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (!isSend(request)) return next(request)
        keys.push(request.headers.get('idempotency-key'))
        if (inProgress) return Promise.resolve(problem(409, { code: 'IDEMPOTENCY_KEY_IN_PROGRESS' }))
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      // BFF가 시간 초과로 끝낸 발송을 새 API가 아직 보내는 중입니다. 재시도는 409를 받고 결과를 모릅니다.
      inProgress = true
      const refused = await sendRows(signedIn, cardId, [wageRowId])
      custom.advance(5 * 60_000)
      inProgress = false
      expect((await sendRows(signedIn, cardId, [wageRowId])).status).toBe(200)

      expect(refused.status).toBe(409)
      expect((await refused.json()).code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS')
      expect(keys[1]).toBe(keys[0])
    } finally {
      await custom.dispose()
    }
  })

  it('refuses a replayed job for other payslips instead of reporting it as sent', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: async (request, next) => {
        if (!isSend(request)) return next(request)
        const job = {
          id: 'job_01JBQ000000000000000000000',
          status: 'SUCCEEDED',
          result: { items: [{ payslipId: 'psl_01JBQ000000000000000000000', status: 'SENT', failureReason: null }] },
          createdAt: '2026-10-01T00:00:00.000Z',
          finishedAt: '2026-10-01T00:00:00.000Z',
        }
        return new Response(JSON.stringify(job), { status: 202, headers: { 'content-type': 'application/json' } })
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await sendRows(signedIn, cardId, [wageRowId])

      expect(response.status).toBe(422)
      expect((await response.json()).code).toBe('IDEMPOTENCY_KEY_REUSED')
    } finally {
      await custom.dispose()
    }
  })

  it('waits for a slow send with the send timeout instead of the general one', async () => {
    const { harness: custom, client: signedIn } = await watched({
      timeoutMs: 100,
      sendTimeoutMs: 5_000,
      delaySend: () => 300,
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await sendRows(signedIn, cardId, [wageRowId])

      expect(response.status).toBe(200)
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)
    } finally {
      await custom.dispose()
    }
  })

  it('sends again right away when nothing went out the first time', async () => {
    let businessRowId = ''
    const { harness: custom, client: signedIn, keys } = await watched()
    try {
      const { cardId } = await closedCard(signedIn, {
        before: async (id) => void (businessRowId = await addBusinessRow(custom, id)),
      })

      const first = await sendRows(signedIn, cardId, [businessRowId])
      const second = await sendRows(signedIn, cardId, [businessRowId])

      expect((await first.json()).results[0].status).toBe('fail')
      expect((await second.json()).results[0].status).toBe('fail')
      expect(keys[1]).not.toBe(keys[0])
      const business = (await upstreamPayslips(custom, cardId)).find((item) => item.rowId === businessRowId)
      expect(business.delivery.attempts).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('never logs recipient addresses or pay amounts', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    )
    try {
      let businessRowId = ''
      const { cardId, wageRowId } = await closedCard(client, {
        before: async (id) => void (businessRowId = await addBusinessRow(harness, id)),
      })
      await client.request('GET', `${PAYROLL}/cards/${cardId}/payslip/`)
      await sendRows(client, cardId, [wageRowId, businessRowId])
      await client.request('POST', `${PAYROLL}/cards/${cardId}/payslip/`, {
        body: { wage_salary: [{ id: wageRowId, email: 'other@example.com' }] },
      })

      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
      for (const secret of [KIM_EMAIL, 'other@example.com', '3346950', '3,346,950']) {
        expect(logged).not.toContain(secret)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('saving payslip emails and formulas', () => {
  const save = (signedIn: LegacyClient, cardId: string, body: unknown) =>
    signedIn.request('POST', `${PAYROLL}/cards/${cardId}/payslip/`, { body })

  it('accepts the values the screen received and refuses changes the new API cannot keep', async () => {
    let businessRowId = ''
    const { cardId, wageRowId } = await closedCard(client, {
      before: async (id) => void (businessRowId = await addBusinessRow(harness, id)),
    })

    const unchanged = await save(client, cardId, {
      wage_salary: [{ id: wageRowId, email: KIM_EMAIL, payment_formulas: {} }],
    })
    const cleared = await save(client, cardId, { wage_salary: [{ id: wageRowId, email: null }] })
    const empty = await save(client, cardId, { wage_salary: [] })
    const changed = await save(client, cardId, {
      wage_salary: [
        { id: wageRowId, email: KIM_EMAIL },
        { id: wageRowId, email: 'other@example.com' },
      ],
    })
    const business = await save(client, cardId, { wage_salary: [{ id: businessRowId }] })
    const unknown = await save(client, cardId, { wage_salary: [{ id: UNKNOWN_ROW }] })

    expect(unchanged.status).toBe(200)
    expect(await unchanged.json()).toEqual({ saved: 1 })
    expect(await cleared.json()).toEqual({ saved: 1 })
    expect(await empty.json()).toEqual({ saved: 0 })
    expect(changed.status).toBe(422)
    expect((await changed.json()).errors).toEqual({ 'wage_salary.1.email': ['Not supported by the new API yet.'] })
    expect(business.status).toBe(404)
    expect(await business.json()).toEqual({
      detail: `Wage row ${businessRowId} is not on this payroll card.`,
      code: 'NOT_FOUND',
    })
    expect(unknown.status).toBe(404)
  })

  it('refuses an email when the user may not read employees', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname === '/v1/employees'
          ? Promise.resolve(problem(403, { code: 'PERMISSION_DENIED' }))
          : next(request),
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)

      const response = await save(signedIn, cardId, { wage_salary: [{ id: wageRowId, email: KIM_EMAIL }] })

      expect(response.status).toBe(422)
      expect(Object.keys((await response.json()).errors)).toEqual(['wage_salary.0.email'])
    } finally {
      await custom.dispose()
    }
  })

  it('validates the body before reading the card or any employee', async () => {
    const calls: string[] = []
    let watching = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (watching) calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await closedCard(signedIn)
      watching = true
      const cases: Array<[unknown, string]> = [
        [{}, 'wage_salary'],
        [{ wage_salary: {} }, 'wage_salary'],
        [{ wage_salary: Array.from({ length: 501 }, () => ({ id: wageRowId })) }, 'wage_salary'],
        [{ wage_salary: ['x'] }, 'wage_salary.0'],
        [{ wage_salary: [{}] }, 'wage_salary.0.id'],
        [{ wage_salary: [{ id: 7 }] }, 'wage_salary.0.id'],
        [{ wage_salary: [{ id: wageRowId, email: 7 }] }, 'wage_salary.0.email'],
        [{ wage_salary: [{ id: wageRowId, email: 'not-an-email' }] }, 'wage_salary.0.email'],
        [{ wage_salary: [{ id: wageRowId, payment_formulas: [] }] }, 'wage_salary.0.payment_formulas'],
        [{ wage_salary: [{ id: wageRowId, payment_formulas: { 식대: '월 정액' } }] }, 'wage_salary.0.payment_formulas'],
      ]
      for (const [body, field] of cases) {
        const response = await save(signedIn, cardId, body)
        expect(response.status).toBe(422)
        expect(Object.keys((await response.json()).errors)).toEqual([field])
      }
      const malformed = await save(signedIn, cardId, { wage_salary: [{ id: wageRowId, email: 'not-an-email' }] })
      expect((await malformed.json()).errors).toEqual({ 'wage_salary.0.email': ['Invalid email address.'] })

      expect(calls).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('has no previous formulas to copy', async () => {
    const { cardId } = await closedCard(client)

    const response = await client.request(
      'POST',
      `${PAYROLL}/cards/${cardId}/payslip/wage-salary/copy-payment-formulas/`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: {} })
  })
})
