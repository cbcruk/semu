import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'
import { FAKE_REJECTED_BUYER_NUMBER } from '../ports/hometax-invoice-issuer.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
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

describe('/v1/sales-transactions', () => {
  it('creates a statement with an item summary', async () => {
    const response = await app.send('POST', '/v1/sales-transactions', { body: STATEMENT })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ itemSummary: '양극재 외 1건', issueStatus: 'ISSUE_REQUIRED' })
  })

  it('reports every statement problem at once', async () => {
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
})

describe('POST /v1/tax-invoices', () => {
  it('requires an Idempotency-Key', async () => {
    const statement = await create()
    const response = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: statement.id } })

    expect(response.status).toBe(428)
  })

  it('issues once per key, records sales evidence and locks the statement', async () => {
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

  it('keeps a failed attempt when Hometax rejects and allows a retry with a new key', async () => {
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

  it('refuses a key reused for another statement', async () => {
    const a = await create()
    const b = await create()
    const headers = { 'idempotency-key': 'shared' }
    await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: a.id }, headers })
    const response = await app.send('POST', '/v1/tax-invoices', { body: { salesTransactionId: b.id }, headers })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })
})
