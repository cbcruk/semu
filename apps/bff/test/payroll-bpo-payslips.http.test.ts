import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_COMPANY_IDS, makeHarness } from './legacy-client.ts'
import type { Harness, HarnessOptions, LegacyClient } from './legacy-client.ts'

const PAYROLL = `/api/company/${DEMO_COMPANY_IDS.corporation}/payroll`
const BPO = `${PAYROLL}/bpo/card`
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

/** 새 API에서 대장의 명세서를 바로 읽습니다. */
async function upstreamPayslips(target: Harness, ledgerId: string): Promise<any[]> {
  const response = await target.api.request('GET', `/v1/payslips?ledgerId=${ledgerId}`, {
    token: await ownerToken(target),
  })
  return (await response.json()).items
}

/** 새 API로 직원이 아닌 소득자 행을 더합니다(이메일 없음). */
async function addRow(target: Harness, ledgerId: string, payeeName: string, input: Record<string, unknown>) {
  const response = await target.api.request('POST', `/v1/payroll-ledgers/${ledgerId}/rows`, {
    token: await ownerToken(target),
    body: { payeeName, input },
  })
  expect(response.status).toBe(201)
  return (await response.json()).id as string
}

/** 근로 행에 연장 90분·야간 30분 근무와 주휴 4주를 넣습니다. 미리보기의 근무 정보 번역을 봅니다. */
async function addWork(target: Harness, ledgerId: string, rowId: string): Promise<void> {
  const token = await ownerToken(target)
  const rows = await (await target.api.request('GET', `/v1/payroll-ledgers/${ledgerId}/rows`, { token })).json()
  const row = rows.items.find((item: any) => item.id === rowId)
  const response = await target.api.request('PATCH', `/v1/payroll-ledgers/${ledgerId}/rows/${rowId}`, {
    token,
    body: { input: { ...row.input, work: { overtimeMinutes: 90, nightMinutes: 30 } } },
  })
  expect(response.status).toBe(200)
}

interface Card {
  cardId: string
  wageRowId: string
  businessRowId: string
  dailyRowId: string
  otherRowId: string
}

/** BFF로 카드를 만들고 근로 외 행을 더한 뒤, `close`면 계산 확정·확정까지 합니다. */
async function card(signedIn: LegacyClient, target: Harness, options: { close?: boolean } = {}): Promise<Card> {
  const created = await signedIn.request('POST', `${PAYROLL}/cards/`, { body: { attribution_month: '2026-09' } })
  expect(created.status).toBe(201)
  const body = await created.json()
  const cardId: string = body.id
  const wageRowId: string = body.wage_salary[0].id
  await addWork(target, cardId, wageRowId)
  const businessRowId = await addRow(target, cardId, '박프리', { incomeType: 'BUSINESS', payAmount: 1_000_000 })
  const dailyRowId = await addRow(target, cardId, '이일용', { incomeType: 'DAILY', payAmount: 150_000, workDays: 1 })
  const otherRowId = await addRow(target, cardId, '최강연', { incomeType: 'OTHER', payAmount: 500_000 })
  if (options.close !== false) {
    expect((await signedIn.request('POST', `${PAYROLL}/cards/${cardId}/calculate/`)).status).toBe(200)
    expect((await signedIn.request('POST', `${PAYROLL}/cards/${cardId}/extensions/fix/`)).status).toBe(200)
  }
  return { cardId, wageRowId, businessRowId, dailyRowId, otherRowId }
}

function send(signedIn: LegacyClient, cardId: string, rowIds: unknown, headers?: Record<string, string>) {
  return signedIn.request('POST', `${BPO}/${cardId}/payslip/send/`, {
    body: { row_ids: rowIds },
    ...(headers === undefined ? {} : { headers }),
  })
}

describe('BPO payslip list and preview (급여 명세서 관리)', () => {
  it('lists each income group of a closed card with the HR email and the new payslip status', async () => {
    const employeeReads: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (new URL(request.url).pathname === '/v1/employees') employeeReads.push(request.url)
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId, businessRowId, dailyRowId, otherRowId } = await card(signedIn, custom)
      const upstream = await upstreamPayslips(custom, cardId)
      const netPay = (rowId: string) => upstream.find((item) => item.rowId === rowId).netPay

      const lists = Object.fromEntries(
        await Promise.all(
          ['wage', 'business', 'daily', 'other'].map(async (group) => {
            const response = await signedIn.request('GET', `${BPO}/${cardId}/${group}/payslip/`)
            expect(response.status).toBe(200)
            return [group, (await response.json()).results]
          }),
        ),
      )

      expect(lists['wage']).toEqual([
        {
          row_id: wageRowId,
          id: wageRowId,
          name: '김세무',
          birth_date: null,
          income_type: 'wage-monthly',
          payslip_group: 'wage',
          department: null,
          email: KIM_EMAIL,
          notification_status: null,
          sent_at: null,
          fail_reason: null,
          net_pay: netPay(wageRowId),
        },
      ])
      expect(lists['business']).toEqual([
        expect.objectContaining({
          row_id: businessRowId,
          name: '박프리',
          income_type: 'business',
          payslip_group: 'business',
          email: null,
          net_pay: netPay(businessRowId),
        }),
      ])
      expect(lists['daily'].map((row: any) => [row.row_id, row.income_type])).toEqual([[dailyRowId, 'daily']])
      expect(lists['other'].map((row: any) => [row.row_id, row.income_type])).toEqual([[otherRowId, 'other']])
      // 근로 외 소득자도 HR 직원일 수 있어 종류를 거르지 않고 읽습니다. 직원에 이어진 행이 없는 묶음은 읽지 않습니다.
      expect(employeeReads).toHaveLength(1)
      expect(new URL(employeeReads[0] as string).searchParams.has('kind')).toBe(false)
    } finally {
      await custom.dispose()
    }
  })

  it('previews a wage payslip with the amounts, the engine formulas and the work sheet in hours', async () => {
    const { cardId, wageRowId } = await card(client, harness)
    const upstream = (await upstreamPayslips(harness, cardId)).find((item) => item.rowId === wageRowId)

    const response = await client.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      row_id: wageRowId,
      name: '김세무',
      income_type: 'wage-monthly',
      payslip_group: 'wage',
      email: KIM_EMAIL,
      notification_status: null,
      attribution_month: '2026-09',
      payment_date: upstream.paymentDate,
      gross_pay: upstream.grossPay,
      deduction_total: upstream.deductionTotal,
      net_pay: upstream.netPay,
      payment_formulas: {},
      work: {
        regular_hours: 0,
        overtime_hours: 1.5,
        night_hours: 0.5,
        holiday_hours: 0,
        holiday_overtime_hours: 0,
        absence_hours: 0,
        weekly_holiday_deduction_days: 0,
        weekly_holiday_weeks: 0,
      },
    })
    // 새 명세서와 같은 줄이고, 계산식은 행 계산 결과의 것입니다.
    expect(body.payments.map(({ formula: _formula, ...line }: any) => line)).toEqual(upstream.payments)
    expect(body.deductions.map(({ formula: _formula, ...line }: any) => line)).toEqual(upstream.deductions)
    expect(body.payments.every((line: any) => typeof line.formula === 'string')).toBe(true)
  })

  it('previews a non-wage payslip without a work sheet', async () => {
    const { cardId, businessRowId } = await card(client, harness)

    const body = await (await client.request('GET', `${BPO}/${cardId}/business/payslip/${businessRowId}/`)).json()

    expect(body).toMatchObject({ row_id: businessRowId, payslip_group: 'business', email: null, work: null })
    expect(body.net_pay).toBeGreaterThan(0)
  })

  it('reads one employee for a preview, and leaves the email empty when the user may not read employees', async () => {
    const employeeReads: string[] = []
    let denied = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        const path = new URL(request.url).pathname
        if (request.method === 'GET' && path.startsWith('/v1/employees')) {
          employeeReads.push(path)
          if (denied) return Promise.resolve(problem(403, { code: 'PERMISSION_DENIED' }))
        }
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)
      employeeReads.length = 0

      const allowed = await (await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)).json()
      denied = true
      const hidden = await (await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)).json()
      const list = await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/`)

      expect(allowed.email).toBe(KIM_EMAIL)
      expect(employeeReads.slice(0, 1)).toEqual([`/v1/employees/${KIM}`])
      expect(hidden.email).toBeNull()
      expect(list.status).toBe(200)
      expect((await list.json()).results[0].email).toBeNull()
    } finally {
      await custom.dispose()
    }
  })

  it('does not hide other failures of the employee read', async () => {
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) =>
        request.method === 'GET' && new URL(request.url).pathname.startsWith('/v1/employees')
          ? Promise.resolve(problem(403, { code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['PAYROLL'] }))
          : next(request),
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)

      const list = await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/`)
      const preview = await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)

      expect(list.status).toBe(403)
      expect((await list.json()).code).toBe('ENTITLEMENT_REQUIRED')
      expect(preview.status).toBe(403)
    } finally {
      await custom.dispose()
    }
  })

  it('lists and previews a card that is not closed without asking the new API for payslips', async () => {
    const reads: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (new URL(request.url).pathname.startsWith('/v1/payslips')) reads.push(request.url)
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom, { close: false })

      const list = await (await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/`)).json()
      const preview = await (await signedIn.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)).json()
      const sent = await send(signedIn, cardId, [wageRowId])

      expect(list.results).toEqual([expect.objectContaining({ row_id: wageRowId, notification_status: null })])
      expect(preview).toMatchObject({ row_id: wageRowId, work: expect.objectContaining({ overtime_hours: 1.5 }) })
      expect(sent.status).toBe(409)
      expect(await sent.json()).toEqual({
        detail: 'Payslips are available once the payroll card is approved.',
        code: 'INVALID_TRANSITION',
      })
      expect(reads).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('answers an unknown group or row with the legacy 404, after the card', async () => {
    const { cardId, wageRowId, businessRowId } = await card(client, harness)

    const cases: Array<[string, string]> = [
      [`${BPO}/${cardId}/wage-monthly/payslip/`, 'Payslip group not found.'],
      [`${BPO}/${cardId}/wage-salary/payslip/${wageRowId}/`, 'Payslip group not found.'],
      [`${BPO}/${UNKNOWN_LEDGER}/nope/payslip/`, 'Payroll card not found.'],
      [`${BPO}/${cardId}/wage/payslip/${businessRowId}/`, 'Payroll row not found.'],
      [`${BPO}/${cardId}/business/payslip/${wageRowId}/`, 'Payroll row not found.'],
      [`${BPO}/${cardId}/wage/payslip/${UNKNOWN_ROW}/`, 'Payroll row not found.'],
      [`${BPO}/${cardId}/wage/payslip/123/`, 'Payroll row not found.'],
    ]
    for (const [path, detail] of cases) {
      const response = await client.request('GET', path)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ detail, code: 'NOT_FOUND' })
    }
  })

  it('answers cards that are not new ledger IDs, or unknown, with the legacy 404 on every BPO payslip route', async () => {
    for (const id of ['123', UNKNOWN_LEDGER]) {
      const responses = [
        await client.request('GET', `${BPO}/${id}/wage/payslip/`),
        await client.request('GET', `${BPO}/${id}/wage/payslip/${UNKNOWN_ROW}/`),
        await send(client, id, [UNKNOWN_ROW]),
      ]
      for (const response of responses) {
        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ detail: 'Payroll card not found.', code: 'NOT_FOUND' })
      }
    }
  })

  it('keeps the PDF download a legacy 404, since the new API has no payslip PDF', async () => {
    const { cardId, wageRowId } = await card(client, harness)

    const response = await client.request('POST', `${BPO}/${cardId}/payslip/download/`, {
      body: { row_ids: [wageRowId], income_type: 'wage' },
    })

    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('NOT_FOUND')
  })

  it('opens BPO payslips to company users and a taxation-only company', async () => {
    const { cardId, wageRowId } = await card(client, harness)
    const owner = harness.client()
    await owner.login(OWNER)
    // 2026-11-07에 새 명세서를 PAYROLL 또는 TAXATION에 열기로 정했습니다. 현행 BPO 메뉴(급여 정산)는 PAYROLL만이었습니다.
    const individual = `/api/company/${DEMO_COMPANY_IDS.individual}/payroll`
    const created = await (
      await client.request('POST', `${individual}/cards/`, { body: { attribution_month: '2026-09' } })
    ).json()

    const ownerList = await owner.request('GET', `${BPO}/${cardId}/wage/payslip/`)
    const ownerPreview = await owner.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)
    const taxationOnly = await client.request('GET', `${individual}/bpo/card/${created.id}/wage/payslip/`)

    expect(ownerList.status).toBe(200)
    expect(ownerPreview.status).toBe(200)
    expect(taxationOnly.status).toBe(200)
  })
})

describe('sending BPO payslips', () => {
  it('sends any income group in card order and answers with the BPO card, which stays approved', async () => {
    const { cardId, wageRowId, businessRowId, otherRowId } = await card(client, harness)

    const sent = await send(client, cardId, [otherRowId, businessRowId, wageRowId, wageRowId])
    const body = await sent.json()
    const wage = await (await client.request('GET', `${BPO}/${cardId}/wage/payslip/`)).json()
    const business = await (await client.request('GET', `${BPO}/${cardId}/business/payslip/`)).json()

    expect(sent.status).toBe(200)
    expect(body.results).toEqual([
      { row_id: wageRowId, notification_status: 'success', fail_reason: null },
      { row_id: businessRowId, notification_status: 'fail', fail_reason: 'no_email' },
      { row_id: otherRowId, notification_status: 'fail', fail_reason: 'no_email' },
    ])
    expect(body.card).toMatchObject({
      id: cardId,
      generation: 'bpo',
      kind: 'default',
      parent_card_id: null,
      status: 'approved',
      legacy_status: 'done',
      step_count: 3,
      payslips_sent_at: null,
      headcount_by_type: { 'wage-monthly': 1, daily: 1, business: 1, other: 1 },
      uncalculated_count: 0,
      withholding_filed: false,
    })
    for (const key of ['attr_date', 'card_status', 'headcount', 'net_pay_total_by_type']) {
      expect(body.card).not.toHaveProperty(key)
    }
    expect(wage.results[0]).toMatchObject({ notification_status: 'success', sent_at: expect.any(String) })
    expect(business.results[0]).toMatchObject({ notification_status: 'fail', fail_reason: 'no_email', sent_at: null })
    expect((await upstreamPayslips(harness, cardId)).map((item) => item.delivery.attempts)).toEqual([1, 1, 0, 1])
  })

  it('lets company users send, like the legacy client and agency actors', async () => {
    const { cardId, wageRowId } = await card(client, harness)
    const owner = harness.client()
    await owner.login(OWNER)

    const sent = await send(owner, cardId, [wageRowId])

    expect(sent.status).toBe(200)
    expect((await sent.json()).results[0].notification_status).toBe('success')
  })

  it('validates the body, the card state and the row IDs before sending, like the legacy server', async () => {
    const calls: string[] = []
    let watching = false
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (watching) calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)
      watching = true

      for (const body of [{}, { row_ids: [] }, { row_ids: 'x' }, { row_ids: [1] }]) {
        const response = await signedIn.request('POST', `${BPO}/${cardId}/payslip/send/`, { body })
        expect(response.status).toBe(422)
      }
      expect(calls).toEqual([])

      const badFormat = await send(signedIn, cardId, ['123'])
      expect(badFormat.status).toBe(422)
      expect((await badFormat.json()).errors).toEqual({ row_ids: ['Some rows are not on this payroll card.'] })
      expect(calls.some((call) => call.includes('/v1/payslips'))).toBe(false)

      const notOnCard = await send(signedIn, cardId, [wageRowId, UNKNOWN_ROW])
      expect(notOnCard.status).toBe(422)
      expect(calls.some((call) => call === 'POST /v1/payslips:send')).toBe(false)
      expect((await upstreamPayslips(custom, cardId)).every((item) => item.delivery.attempts === 0)).toBe(true)
    } finally {
      await custom.dispose()
    }
  })

  it('sends nothing when the card header cannot be read', async () => {
    let failRows = false
    const sends: string[] = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (isSend(request)) sends.push(request.url)
        if (failRows && request.method === 'GET' && new URL(request.url).pathname.endsWith('/rows')) {
          return Promise.resolve(problem(503, { code: 'SERVICE_UNAVAILABLE' }))
        }
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)
      failRows = true

      const sent = await send(signedIn, cardId, [wageRowId])

      expect(sent.status).toBe(503)
      expect(sends).toEqual([])
    } finally {
      await custom.dispose()
    }
  })

  it('shares the send key with the legacy card screen, so a double submit across them sends once', async () => {
    const keys: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (isSend(request)) keys.push(request.headers.get('idempotency-key'))
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)

      const first = await send(signedIn, cardId, [wageRowId])
      const again = await send(signedIn, cardId, [wageRowId])
      const legacy = await signedIn.request('POST', `${PAYROLL}/cards/${cardId}/payslip/wage-salary/notifications/`, {
        body: { row_ids: [wageRowId] },
      })

      expect([first.status, again.status, legacy.status]).toEqual([200, 200, 200])
      expect(keys).toHaveLength(3)
      expect(new Set(keys).size).toBe(1)
      expect(keys[0]).toMatch(/^bff-payslip-send:/)
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)

      custom.advance(61_000)
      await send(signedIn, cardId, [wageRowId])
      expect(new Set(keys).size).toBe(2)
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(2)
    } finally {
      await custom.dispose()
    }
  })

  it('binds a client Idempotency-Key to the session and the payslips', async () => {
    const keys: Array<string | null> = []
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (isSend(request)) keys.push(request.headers.get('idempotency-key'))
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)

      await send(signedIn, cardId, [wageRowId], { 'idempotency-key': 'client-key-1' })
      await send(signedIn, cardId, [wageRowId], { 'idempotency-key': 'client-key-1' })

      expect(keys).toHaveLength(2)
      expect(keys[0]).toMatch(/^bff-client:/)
      expect(keys[0]).not.toContain('client-key-1')
      expect(keys[1]).toBe(keys[0])
      expect((await upstreamPayslips(custom, cardId))[0].delivery.attempts).toBe(1)
    } finally {
      await custom.dispose()
    }
  })

  it('keeps the key for a day after an interrupted send', async () => {
    const keys: Array<string | null> = []
    let interrupt = true
    const { harness: custom, client: signedIn } = await intercepted({
      intercept: (request, next) => {
        if (!isSend(request)) return next(request)
        keys.push(request.headers.get('idempotency-key'))
        if (interrupt) {
          interrupt = false
          return Promise.resolve(problem(503, { code: 'PAYSLIP_SEND_INTERRUPTED' }))
        }
        return next(request)
      },
    })
    try {
      const { cardId, wageRowId } = await card(signedIn, custom)

      const first = await send(signedIn, cardId, [wageRowId])
      custom.advance(10 * 60_000)
      const retry = await send(signedIn, cardId, [wageRowId])

      expect(first.status).toBe(503)
      expect(retry.status).toBe(200)
      expect(keys[1]).toBe(keys[0])
    } finally {
      await custom.dispose()
    }
  })

  it('never logs recipient addresses or pay amounts', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    )
    try {
      const { cardId, wageRowId, businessRowId } = await card(client, harness)
      const netPay = String((await upstreamPayslips(harness, cardId))[0].netPay)
      await client.request('GET', `${BPO}/${cardId}/wage/payslip/`)
      await client.request('GET', `${BPO}/${cardId}/wage/payslip/${wageRowId}/`)
      await send(client, cardId, [wageRowId, businessRowId])

      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
      for (const secret of [KIM_EMAIL, netPay, Number(netPay).toLocaleString('en-US')]) {
        expect(logged).not.toContain(secret)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
