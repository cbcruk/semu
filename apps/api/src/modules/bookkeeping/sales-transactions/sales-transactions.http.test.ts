import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../../identity-access/testing.ts'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'
import { FAKE_REJECTED_BUYER_NUMBER } from '../ports/hometax-invoice-issuer.ts'

let app: TestApp
/** 데모 거래처가 없는 다른 회사의 행위자입니다. */
const OTHER_COMPANY_ID = 'cmp_01JBQ0000000000000000OTHER' as Id<'company'>

beforeEach(() => {
  app = testApp({ other: testActor({ companyId: OTHER_COMPANY_ID }) })
})
afterEach(() => app.dispose())

const party = (businessNumber: string, companyName: string) => ({ businessNumber, companyName })

const STATEMENT = {
  partnerId: 'ptn_01JBQ000000000000000000001',
  invoiceClassCode: '01',
  invoiceKindCode: '01',
  buyerClassCode: '01',
  purposeCode: '02',
  writeDate: '2026-11-05',
  note: null,
  payment: { cashAmount: null, checkAmount: null, noteAmount: null, creditAmount: 2_200_000 },
  buyerSecondaryEmail: null,
  items: [
    {
      monthDay: '11-05',
      name: '양극재',
      specification: null,
      quantity: '1',
      unitPrice: 1_000_000,
      supplyAmount: 1_000_000,
      vatAmount: 100_000,
      description: null,
    },
    {
      monthDay: '11-05',
      name: '운반비',
      specification: null,
      quantity: null,
      unitPrice: null,
      supplyAmount: 1_000_000,
      vatAmount: 100_000,
      description: null,
    },
  ],
  supplyAmount: 2_000_000,
  vatAmount: 200_000,
  totalAmount: 2_200_000,
  supplier: party('1234567890', '데모 주식회사'),
  buyer: party('1108100011', '에코프로비엠'),
}

async function create(overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const response = await app.send('POST', '/v1/sales-transactions', { body: { ...STATEMENT, ...overrides } })
  return (await response.json()) as { id: string; version: number }
}

describe('거래명세서(/v1/sales-transactions)', () => {
  it('거래명세서를 만들면 품목 요약을 붙입니다', async () => {
    const response = await app.send('POST', '/v1/sales-transactions', { body: STATEMENT })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ itemSummary: '양극재 외 1건', issueStatus: 'ISSUE_REQUIRED' })
  })

  it('거래명세서의 문제를 한 번에 모두 알려 줍니다', async () => {
    const response = await app.send('POST', '/v1/sales-transactions', {
      body: { ...STATEMENT, invoiceKindCode: '03', totalAmount: 1 },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'SALES_STATEMENT_INVALID',
      problems: [
        { code: 'UNSUPPORTED', field: 'invoiceKindCode' },
        { code: 'AMOUNT_MISMATCH', field: 'totalAmount' },
      ],
    })
  })

  it('만들 때 다른 회사의 거래처는 거절합니다', async () => {
    const response = await app.send('POST', '/v1/sales-transactions', { token: 'other', body: STATEMENT })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'PARTNER_NOT_FOUND' })
  })

  it('고칠 때 없는 거래처나 다른 회사의 거래처는 거절합니다', async () => {
    const created = await create({ partnerId: null })

    const response = await app.send('PATCH', `/v1/sales-transactions/${created.id}`, {
      body: { partnerId: 'ptn_01JBQ000000000000000000099' },
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'PARTNER_NOT_FOUND' })
  })
})

describe('전자세금계산서 발급(POST /v1/tax-invoices)', () => {
  it('Idempotency-Key가 있어야 합니다', async () => {
    const statement = await create()
    const response = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: statement.id } })

    expect(response.status).toBe(428)
  })

  it('키마다 한 번만 발급하고 매출 증빙을 남기며 거래명세서를 잠급니다', async () => {
    const statement = await create()
    const headers = { 'idempotency-key': 'issue-1' }
    const first = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: statement.id }, headers })
    const replay = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: statement.id }, headers })
    const again = await app.send('POST', '/v1/tax-invoices', {
      body: { salesTransactionId: statement.id },
      headers: { 'idempotency-key': 'issue-2' },
    })
    const edit = await app.send('PATCH', `/v1/sales-transactions/${statement.id}`, { body: { note: '수정' } })
    const evidence = await app.send('GET', '/v1/evidence?side=SALES&source=TAX_INVOICE')

    const invoice = await first.json()
    expect(first.status).toBe(201)
    expect(invoice).toMatchObject({
      status: 'ISSUED',
      approvalNumber: expect.stringMatching(/^20261105-41000000-\d{8}$/),
    })
    expect(await replay.json()).toEqual(invoice)
    expect(again.status).toBe(409)
    expect(edit.status).toBe(409)
    expect(await edit.json()).toMatchObject({ code: 'SALES_TRANSACTION_LOCKED', lock: 'ISSUED' })
    const rows = ((await evidence.json()) as { items: Array<{ salesTransactionId: string | null }> }).items
    expect(rows.filter((row) => row.salesTransactionId === statement.id)).toHaveLength(1)
  })

  it('홈택스가 거절하면 실패 기록을 남기고 새 키로 다시 발급할 수 있습니다', async () => {
    const statement = await create({ buyer: party(FAKE_REJECTED_BUYER_NUMBER, '없는 회사') })
    const rejected = await app.send('POST', '/v1/tax-invoices', {
      body: { salesTransactionId: statement.id },
      headers: { 'idempotency-key': 'k1' },
    })
    await app.send('PATCH', `/v1/sales-transactions/${statement.id}`, {
      body: { buyer: party('1108100011', '에코프로비엠') },
    })
    const retried = await app.send('POST', '/v1/tax-invoices', {
      body: { salesTransactionId: statement.id },
      headers: { 'idempotency-key': 'k2' },
    })
    const listed = await app.send('GET', `/v1/tax-invoices?salesTransactionId=${statement.id}`)

    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({ code: 'TAX_INVOICE_REJECTED', errorCode: 'BUYER_NOT_FOUND' })
    expect(retried.status).toBe(201)
    const { items } = (await listed.json()) as { items: Array<{ status: string }> }
    expect(items.map((row) => row.status).sort()).toEqual(['FAILED', 'ISSUED'])
  })

  it('다른 거래명세서에 다시 쓴 키는 거절합니다', async () => {
    const a = await create()
    const b = await create()
    const headers = { 'idempotency-key': 'shared' }
    await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: a.id }, headers })
    const response = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: b.id }, headers })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })
})
