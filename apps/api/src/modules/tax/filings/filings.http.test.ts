import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { filingRecord } from '../tax-demo.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'
import type { TaxEvent } from '../tax.public.ts'
import type { FilingRecord } from './filing.types.ts'

const VAT_ID = 'fil_01JBQ000000000000000000V01' as Id<'filing'>
const WHT_ID = 'fil_01JBQ000000000000000000W01' as Id<'filing'>
const FILE_ID = 'fle_01JBQ000000000000000000001'
const SLIP_ID = 'fle_01JBQ000000000000000000002'

function vat(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: VAT_ID,
    taxType: 'VAT',
    kind: 'FINAL',
    periodKey: '2026-H2',
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    dueDate: '2027-01-25',
    paymentDue: '2027-01-25',
    status: 'REQUESTED',
    ...overrides,
  })
}

function withholding(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: WHT_ID,
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    dueDate: '2026-11-10',
    paymentDue: '2026-11-10',
    status: 'SETTLED',
    ...overrides,
  })
}

let app: TaxTestApp
afterEach(() => app.dispose())

describe('신고 건 목록 조회(GET /v1/filings)', () => {
  it('최근 기간부터 보여 주고 진행 중인 신고 건으로 거를 수 있습니다', async () => {
    app = taxTestApp({ filings: [vat(), withholding()] })

    const all = await app.send('/filings')
    const open = await app.send('/filings?open=true')

    expect(all.status).toBe(200)
    expect((await all.json()).items.map((item: { id: string }) => item.id)).toEqual([VAT_ID, WHT_ID])
    expect((await open.json()).items).toMatchObject([
      { id: VAT_ID, progress: { stage: 'MATERIALS_OPEN', index: 1, count: 6 } },
    ])
  })

  it('세무 플랜이 없으면 무엇보다 먼저 403 ENTITLEMENT_REQUIRED입니다', async () => {
    app = taxTestApp({ filings: [vat()] })

    const response = await app.send('/filings', { token: 'free' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })
})

describe('신고 건 상세 조회(GET /v1/filings/{filingId})', () => {
  it('보는 행위자가 보낼 수 있는 커맨드와 ETag를 돌려줍니다', async () => {
    app = taxTestApp({ filings: [vat()] })

    const client = await app.send(`/filings/${VAT_ID}`)
    const agency = await app.send(`/filings/${VAT_ID}`, { token: 'agency' })

    expect(client.headers.get('etag')).toBe('"1"')
    expect((await client.json()).allowedActions).toEqual(['SUBMIT'])
    expect((await agency.json()).allowedActions).toEqual(['START_REVIEW', 'CANCEL'])
  })

  it('없는 신고 건은 찾을 수 없다고 답합니다', async () => {
    app = taxTestApp()

    const response = await app.send(`/filings/${VAT_ID}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'FILING_NOT_FOUND' })
  })
})

describe('원천세 신고서 줄(GET /v1/filings/{filingId}/withholding-lines)', () => {
  const wage = { headcount: 2, grossPay: 6_400_000, taxablePay: 6_000_000, incomeTax: 120_760, localIncomeTax: 12_070 }
  const other = { headcount: 1, grossPay: 500_000, taxablePay: 200_000, incomeTax: 40_000, localIncomeTax: 4_000 }

  it('지급월의 소득 종류별 합계를 신고서 소득구분 코드 순서로 보여 줍니다', async () => {
    app = taxTestApp({
      filings: [withholding()],
      payrollLedgers: { '2026-10': { ledgerCount: 2, closedCount: 2 } },
      withholdingTotals: {
        '2026-10': [
          { incomeKind: 'OTHER', ...other },
          { incomeKind: 'WAGE', ...wage },
        ],
      },
    })

    const response = await app.send(`/filings/${WHT_ID}/withholding-lines`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [
        {
          paymentMonth: '2026-10',
          ledgerCount: 2,
          closedCount: 2,
          lines: [
            { lineCode: 'A01', subtotalCode: 'A10', incomeKind: 'WAGE', ...wage },
            { lineCode: 'A42', subtotalCode: 'A40', incomeKind: 'OTHER', ...other },
          ],
        },
      ],
    })
  })

  it('반기 신고 건은 기간의 여섯 지급월을 하나씩 보여 줍니다', async () => {
    app = taxTestApp({
      filings: [
        withholding({ kind: 'SEMIANNUAL', periodKey: '2026-H2', periodStart: '2026-07-01', periodEnd: '2026-12-31' }),
      ],
      payrollLedgers: { '2026-08': { ledgerCount: 1, closedCount: 0 } },
    })

    const items = (await (await app.send(`/filings/${WHT_ID}/withholding-lines`)).json()).items

    expect(items.map((item: { paymentMonth: string }) => item.paymentMonth)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ])
    expect(items[1]).toEqual({ paymentMonth: '2026-08', ledgerCount: 1, closedCount: 0, lines: [] })
  })

  it('원천세가 아닌 신고 건은 줄이 없습니다', async () => {
    app = taxTestApp({ filings: [vat()], withholdingTotals: { '2026-10': [{ incomeKind: 'WAGE', ...wage }] } })

    const response = await app.send(`/filings/${VAT_ID}/withholding-lines`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })

  it('세무 플랜이 없으면 403 ENTITLEMENT_REQUIRED입니다', async () => {
    app = taxTestApp({ filings: [withholding()] })

    const response = await app.send(`/filings/${WHT_ID}/withholding-lines`, { token: 'free' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })
})

describe('자료 제출(POST /v1/filings/{filingId}:submit)', () => {
  it('고객이 답하지 않은 항목이 남았으면 거절하고 그 항목을 알려 줍니다', async () => {
    app = taxTestApp({ filings: [vat()] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'FILING_REQUIREMENTS_PENDING',
      requirementCodes: expect.arrayContaining(['PG_ONLINE_SALES', 'DEPOSIT_FUND_ACCOUNTS']),
    })
  })

  it('모든 항목에 답하면 제출하고 상태 변경 이벤트를 냅니다', async () => {
    const events: TaxEvent[] = []
    app = taxTestApp({ filings: [vat()], events })
    const codes = vat().requirements.map((requirement) => requirement.code)

    for (const code of codes.slice(1)) {
      const answered = await app.send(`/filings/${VAT_ID}/requirements/${code}`, {
        method: 'PATCH',
        body: { response: 'NOT_APPLICABLE' },
      })
      expect(answered.status).toBe(200)
    }
    const attached = await app.send(`/filings/${VAT_ID}/requirements/${codes[0]}/files`, { body: { fileId: FILE_ID } })
    const submitted = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', ifMatch: `"${codes.length + 1}"` })

    expect((await attached.json()).requirements[0]).toMatchObject({ response: 'PROVIDED', fileIds: [FILE_ID] })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ status: 'SUBMITTED', allowedActions: ['UNSUBMIT'] })
    expect(events).toMatchObject([
      { type: 'filing.status_changed', filingId: VAT_ID, fromStatus: 'REQUESTED', toStatus: 'SUBMITTED' },
    ])
  })

  it('제출은 고객의 커맨드입니다', async () => {
    app = taxTestApp({ filings: [vat({ requirements: [] })] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', token: 'agency' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'FILING_ACTOR_NOT_ALLOWED',
      action: 'SUBMIT',
      requiredActorKind: 'CLIENT',
    })
  })

  it('오래된 If-Match는 거절합니다', async () => {
    app = taxTestApp({ filings: [vat({ requirements: [] })] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', ifMatch: '"7"' })

    expect(response.status).toBe(412)
    expect(await response.json()).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })
})

describe('부가세 신고 흐름', () => {
  it('검토·매입매출장 확인·신고·납부를 할 일 카드와 맞춰 진행합니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED', requirements: [] })] })
    const agency = { token: 'agency' as const }

    expect((await app.send(`/filings/${VAT_ID}:start-review`, { ...agency, method: 'POST' })).status).toBe(200)
    const uploaded = await app.send(`/filings/${VAT_ID}:upload-ledger`, { ...agency, body: { ledgerFileId: FILE_ID } })
    expect(await uploaded.json()).toMatchObject({ status: 'LEDGER_PENDING', documents: [{ type: 'LEDGER' }] })

    const cards = await (await app.send('/action-cards')).json()
    expect(cards.items).toMatchObject([{ kind: 'CONFIRM_LEDGER', status: 'OPEN', subject: { filingId: VAT_ID } }])

    const confirmed = await app.send(`/filings/${VAT_ID}:confirm-ledger`, { method: 'POST' })
    expect(await confirmed.json()).toMatchObject({ status: 'PREPARING' })

    const filed = await app.send(`/filings/${VAT_ID}:file`, {
      ...agency,
      body: { payableAmount: 120_000, returnFileId: FILE_ID, paymentSlipFileId: SLIP_ID },
    })
    const filedBody = await filed.json()
    expect(filedBody).toMatchObject({ status: 'FILED', payableAmount: 120_000, paymentDue: '2027-01-25' })
    expect(filedBody.paymentSlipSentAt).not.toBeNull()

    const clientView = await (await app.send(`/filings/${VAT_ID}`)).json()
    const returnDocument = clientView.documents.find((document: { type: string }) => document.type === 'RETURN')
    expect(clientView.documents.map((document: { type: string }) => document.type).sort()).toEqual([
      'LEDGER',
      'PAYMENT_SLIP',
      'RETURN',
    ])

    const opened = await app.send(`/filings/${VAT_ID}/documents/${returnDocument.id}`)
    expect((await opened.json()).firstViewedAt).not.toBeNull()
    const openKinds = (await (await app.send('/action-cards')).json()).items.map((card: { kind: string }) => card.kind)
    expect(openKinds).toEqual(['PAY_TAX'])

    const paid = await app.send(`/filings/${VAT_ID}:pay`, { body: { paidOn: '2027-01-20' } })
    expect(await paid.json()).toMatchObject({
      status: 'SETTLED',
      settlement: 'PAID',
      paidOn: '2027-01-20',
      allowedActions: [],
    })
    expect(await (await app.send('/action-cards:summary')).json()).toMatchObject({ openCount: 0, closedCount: 3 })
  })

  it('환급 신고 건은 납부 없이 종결합니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'FILED', payableAmount: -50_000 })] })

    const pay = await app.send(`/filings/${VAT_ID}:pay`, { body: { paidOn: '2027-01-20' } })
    const close = await app.send(`/filings/${VAT_ID}:close`, { method: 'POST', token: 'agency' })

    expect(pay.status).toBe(409)
    expect(await pay.json()).toMatchObject({
      code: 'FILING_TRANSITION_INVALID',
      currentStatus: 'FILED',
      command: 'PAY',
    })
    expect(await close.json()).toMatchObject({ status: 'SETTLED', settlement: 'REFUND' })
  })

  it('신고하기 전에는 대리인이 붙인 문서를 고객에게 숨깁니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING', requirements: [] })] })

    const added = await app.send(`/filings/${VAT_ID}/documents`, {
      token: 'agency',
      body: { type: 'RETURN', fileId: FILE_ID },
    })
    const documentId = (await added.json()).documents[0].id
    const client = await app.send(`/filings/${VAT_ID}/documents/${documentId}`)
    const byClient = await app.send(`/filings/${VAT_ID}/documents`, { body: { type: 'RETURN', fileId: FILE_ID } })

    expect(added.status).toBe(200)
    expect(client.status).toBe(404)
    expect(byClient.status).toBe(403)
    expect(await byClient.json()).toMatchObject({ code: 'FILING_ACTOR_NOT_ALLOWED', action: 'ADD_DOCUMENT' })
  })
})

describe('대리인이 고객 대신 보내는 원천세 커맨드(2026-11-07)', () => {
  const clientItems = () =>
    withholding()
      .requirements.filter((requirement) => !requirement.autoLinked)
      .map((requirement) => requirement.code)

  const card = async (kind: string) =>
    (await (await app.send('/action-cards?status=CLOSED')).json()).items
      .concat((await (await app.send('/action-cards')).json()).items)
      .find((item: { kind: string }) => item.kind === kind)

  it('담당 대리인이 응답·제출·제출 취소를 대신하고 이력에 고객 대신 했다고 남깁니다', async () => {
    const events: TaxEvent[] = []
    app = taxTestApp({ filings: [withholding({ status: 'SCHEDULED' })], events })

    const requested = await app.send(`/filings/${WHT_ID}:request`, {
      token: 'agency',
      body: { submitDue: '2026-11-05' },
    })
    expect(requested.status).toBe(200)
    expect(await card('SUBMIT_MATERIALS')).toMatchObject({ status: 'OPEN' })
    for (const code of clientItems()) {
      const answered = await app.send(`/filings/${WHT_ID}/requirements/${code}`, {
        method: 'PATCH',
        token: 'agency',
        body: { response: 'NOT_APPLICABLE' },
      })
      expect(answered.status).toBe(200)
    }
    const version = clientItems().length + 2
    const submitted = await app.send(`/filings/${WHT_ID}:submit`, {
      method: 'POST',
      token: 'agency',
      ifMatch: `"${version}"`,
    })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ status: 'SUBMITTED', allowedActions: ['START_REVIEW', 'CANCEL'] })
    expect((await (await app.send(`/filings/${WHT_ID}`)).json()).allowedActions).toEqual(['UNSUBMIT'])
    expect(await card('SUBMIT_MATERIALS')).toMatchObject({ status: 'DONE' })

    const unsubmitted = await app.send(`/filings/${WHT_ID}:unsubmit`, { method: 'POST', token: 'agency' })
    expect(unsubmitted.status).toBe(200)
    expect(await unsubmitted.json()).toMatchObject({ status: 'REQUESTED' })
    expect(await card('SUBMIT_MATERIALS')).toMatchObject({ status: 'OPEN' })

    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items[0]).toMatchObject({ type: 'REQUEST', actorKind: 'AGENCY' })
    expect(items[0]).not.toHaveProperty('onBehalfOf')
    expect(items[1]).toMatchObject({ type: 'REQUIREMENT_ANSWERED', actorKind: 'AGENCY', onBehalfOf: 'CLIENT' })
    expect(items.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'SUBMIT',
        actorKind: 'AGENCY',
        onBehalfOf: 'CLIENT',
        fromStatus: 'REQUESTED',
        toStatus: 'SUBMITTED',
      }),
      expect.objectContaining({ type: 'UNSUBMIT', actorKind: 'AGENCY', onBehalfOf: 'CLIENT' }),
    ])
    expect(events).toMatchObject([
      { type: 'filing.status_changed', fromStatus: 'SCHEDULED', toStatus: 'REQUESTED' },
      { type: 'filing.status_changed', fromStatus: 'REQUESTED', toStatus: 'SUBMITTED' },
      { type: 'filing.status_changed', fromStatus: 'SUBMITTED', toStatus: 'REQUESTED' },
    ])
  })

  it('담당 대리인이 신고한 건의 납부를 대신 기록하면 납부 카드가 닫힙니다', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'PREPARING' })] })

    const filed = await app.send(`/filings/${WHT_ID}:file`, {
      token: 'agency',
      body: { payableAmount: 120_000, returnFileId: FILE_ID },
    })
    expect(filed.status).toBe(200)
    expect(await card('PAY_TAX')).toMatchObject({ status: 'OPEN' })
    const agencyView = await (await app.send(`/filings/${WHT_ID}`, { token: 'agency' })).json()
    const paid = await app.send(`/filings/${WHT_ID}:pay`, {
      method: 'POST',
      token: 'agency',
      body: { paidOn: '2026-11-10' },
    })

    expect(agencyView.allowedActions).toEqual([])
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ status: 'SETTLED', settlement: 'PAID', paidOn: '2026-11-10' })
    expect(await card('PAY_TAX')).toMatchObject({ status: 'DONE' })
    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items.at(-1)).toMatchObject({
      type: 'PAY',
      actorKind: 'AGENCY',
      onBehalfOf: 'CLIENT',
      detail: { paidOn: '2026-11-10' },
    })
  })

  it('회사를 담당하지 않은 대리인은 거절합니다', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'REQUESTED', requirements: [] })] })

    const submit = await app.send(`/filings/${WHT_ID}:submit`, { method: 'POST', token: 'otherAgency' })
    const answer = await app.send(`/filings/${WHT_ID}/requirements/BUSINESS_INCOME`, {
      method: 'PATCH',
      token: 'otherAgency',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(submit.status).toBe(404)
    expect(await submit.json()).toMatchObject({ code: 'FILING_NOT_FOUND' })
    expect(answer.status).toBe(404)
    expect((await (await app.send(`/filings/${WHT_ID}`)).json()).status).toBe('REQUESTED')
  })

  it.each([
    ['VAT', 'SUBMIT', 'REQUESTED', 'submit'],
    ['VAT', 'UNSUBMIT', 'SUBMITTED', 'unsubmit'],
    ['VAT', 'PAY', 'FILED', 'pay'],
    ['VAT', 'CONFIRM_LEDGER', 'LEDGER_PENDING', 'confirm-ledger'],
    ['CORPORATE_TAX', 'SUBMIT', 'REQUESTED', 'submit'],
    ['CORPORATE_TAX', 'UNSUBMIT', 'SUBMITTED', 'unsubmit'],
    ['CORPORATE_TAX', 'PAY', 'FILED', 'pay'],
    ['INCOME_TAX', 'SUBMIT', 'REQUESTED', 'submit'],
    ['INCOME_TAX', 'UNSUBMIT', 'SUBMITTED', 'unsubmit'],
    ['INCOME_TAX', 'PAY', 'FILED', 'pay'],
  ] as const)('%s의 %s는 대리인이 대신 보낼 수 없는 고객 커맨드입니다', async (taxType, command, status, path) => {
    app = taxTestApp({
      filings: [vat({ taxType, kind: 'FINAL', status, requirements: [], payableAmount: 482_000 })],
    })

    const response = await app.send(`/filings/${VAT_ID}:${path}`, {
      method: 'POST',
      token: 'agency',
      ...(command === 'PAY' ? { body: { paidOn: '2026-11-10' } } : {}),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'FILING_ACTOR_NOT_ALLOWED',
      action: command,
      requiredActorKind: 'CLIENT',
    })
  })

  it('고객이 직접 보내면 대행 표시 없이 고객으로 남깁니다', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'FILED', payableAmount: 120_000 })] })

    const paid = await app.send(`/filings/${WHT_ID}:pay`, { method: 'POST', body: { paidOn: '2026-11-10' } })

    expect(paid.status).toBe(200)
    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items.at(-1)).toMatchObject({ type: 'PAY', actorKind: 'CLIENT' })
    expect(items.at(-1)).not.toHaveProperty('onBehalfOf')
  })
})

describe('고객이 부른 대리인 커맨드(D5)', () => {
  const startReview = (token: 'client' | 'viewer' | 'pendingTerms' | 'demo' | 'free') =>
    app.send(`/filings/${VAT_ID}:start-review`, { method: 'POST', token })

  it('신고 건을 볼 수 있는 고객에게는 FILING_ACTOR_NOT_ALLOWED로 답합니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    for (const token of ['client', 'viewer'] as const) {
      const response = await startReview(token)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'FILING_ACTOR_NOT_ALLOWED',
        action: 'START_REVIEW',
        requiredActorKind: 'AGENCY',
      })
    }
  })

  it('그래도 약관 재동의를 먼저 요구합니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('pendingTerms')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED', termCodes: ['TAX_SERVICE'] })
  })

  it('그래도 데모 계정의 쓰기는 PERMISSION_DENIED입니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('demo')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'filing:process' })
  })

  it('그래도 플랜 확인을 가장 먼저 합니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('free')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })

  it('문서 첨부에도 같은 검사 순서를 씁니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING', requirements: [] })] })
    const attach = (token: 'pendingTerms' | 'demo') =>
      app.send(`/filings/${VAT_ID}/documents`, { token, body: { type: 'RETURN', fileId: FILE_ID } })

    expect(await (await attach('pendingTerms')).json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED' })
    expect(await (await attach('demo')).json()).toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('제출 자료 항목', () => {
  it('REQUESTED가 아니면 고칠 수 없습니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'FILING_LOCKED', currentStatus: 'SUBMITTED' })
  })

  it('자동 연계된 급여대장 항목은 고객이 고칠 수 없습니다', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'REQUESTED' })] })

    const response = await app.send(`/filings/${WHT_ID}/requirements/PAYROLL_LEDGER_CLOSED`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'REQUIREMENT_AUTO_LINKED' })
  })

  it('파일이 붙어 있으면 NOT_APPLICABLE을 받지 않습니다', async () => {
    app = taxTestApp({ filings: [vat()] })

    await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX/files`, { body: { fileId: FILE_ID } })
    const response = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })
    const detached = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX/files/${FILE_ID}`, { method: 'DELETE' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'REQUIREMENT_HAS_FILES' })
    expect((await detached.json()).requirements[1]).toMatchObject({
      code: 'EXPORT_FX',
      response: 'PENDING',
      fileIds: [],
    })
  })
})

describe('입력 검증', () => {
  it('세액에 소수가 있으면 400 VALIDATION_FAILED입니다', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING' })] })

    const response = await app.send(`/filings/${VAT_ID}:file`, {
      token: 'agency',
      body: { payableAmount: 1.5, returnFileId: FILE_ID },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
