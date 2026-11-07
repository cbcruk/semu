import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { httpTestApp, type HttpTestApp } from '../../../shared/testing/http-test-app.ts'
import { DAY_MS, shiftableClock } from '../../../shared/testing/shiftable-clock.ts'
import { testActor } from '../../identity-access/testing.ts'
import { BookkeepingPortFakesLive } from '../bookkeeping.layer.ts'
import {
  FAKE_REJECTED_BUYER_NUMBER,
  HometaxInvoiceIssuer,
  type InvoiceIssueResult,
} from '../ports/hometax-invoice-issuer.ts'

const OTHER_USER_ID = 'usr_01JBQ000000000000000000002' as Id<'user'>

/**
 * 홈택스 발급 가짜입니다. 참조(`idempotencyKey`)마다 한 번만 발급하고(`issued`), 같은 참조가 다시 오면 처음 결과를 돌려줍니다.
 * `dieAfterIssuing`이 참이면 다음 발급은 발급한 뒤 응답 없이 결함으로 끝납니다. 공급받는 자가 없는 사업자면 거절합니다.
 */
interface IssuerControl {
  calls: string[]
  issued: string[]
  delayMs: number
  dieAfterIssuing: boolean
}

function controlledIssuer(control: IssuerControl) {
  const results = new Map<string, InvoiceIssueResult>()
  return Layer.succeed(
    HometaxInvoiceIssuer,
    HometaxInvoiceIssuer.of({
      issue: (request) =>
        Effect.gen(function* () {
          control.calls.push(request.idempotencyKey)
          if (control.delayMs > 0) yield* Effect.sleep(control.delayMs)
          const known = results.get(request.idempotencyKey)
          if (known !== undefined) return known
          if (request.buyerBusinessNumber === FAKE_REJECTED_BUYER_NUMBER) {
            const rejected: InvoiceIssueResult = {
              ok: false,
              errorCode: 'BUYER_NOT_FOUND',
              errorMessage: '공급받는 자의 사업자등록번호를 확인해 주세요.',
            }
            results.set(request.idempotencyKey, rejected)
            return rejected
          }
          control.issued.push(request.idempotencyKey)
          const issued: InvoiceIssueResult = {
            ok: true,
            approvalNumber: `20261105-41000000-${String(control.issued.length).padStart(8, '0')}`,
            issuedAt: '2026-11-05T09:00:00+09:00',
          }
          results.set(request.idempotencyKey, issued)
          if (control.dieAfterIssuing) {
            control.dieAfterIssuing = false
            return yield* Effect.die(new Error('hometax connection reset'))
          }
          return issued
        }),
      fetchDetail: () => Effect.succeed({ found: true }),
    }),
  )
}

const party = (businessNumber: string, companyName: string) => ({ businessNumber, companyName })

const STATEMENT = {
  partnerId: null,
  invoiceClassCode: '01',
  invoiceKindCode: '01',
  buyerClassCode: '01',
  purposeCode: '02',
  writeDate: '2026-11-05',
  note: null,
  payment: { cashAmount: null, checkAmount: null, noteAmount: null, creditAmount: 1_100_000 },
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
  ],
  supplyAmount: 1_000_000,
  vatAmount: 100_000,
  totalAmount: 1_100_000,
  supplier: party('1234567890', '데모 주식회사'),
  buyer: party('1108100011', '에코프로비엠'),
}

interface Fixture {
  app: HttpTestApp
  clock: { ms: number }
  issuer: IssuerControl
}

let fixture: Fixture | null = null

afterEach(async () => {
  await fixture?.app.dispose()
  fixture = null
})

function setUp(): Fixture {
  const clock = { ms: 0 }
  const issuer: IssuerControl = { calls: [], issued: [], delayMs: 0, dieAfterIssuing: false }
  const app = httpTestApp({
    tokens: [
      ['admin', testActor()],
      ['other', testActor({ userId: OTHER_USER_ID })],
    ],
    layers: [BookkeepingPortFakesLive, controlledIssuer(issuer), shiftableClock(clock)],
    basePath: '/v1',
    defaultToken: 'admin',
  })
  fixture = { app, clock, issuer }
  return fixture
}

async function create(app: HttpTestApp, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.json('POST', '/sales-transactions', { body: { ...STATEMENT, ...overrides } })
  expect(response.status).toBe(201)
  return response.body.id
}

function issue(app: HttpTestApp, key: string, salesTransactionId: string, token?: string) {
  return app.json('POST', '/tax-invoices', { idempotencyKey: key, body: { salesTransactionId }, token })
}

describe('POST /tax-invoices idempotency', () => {
  it('issues once and replays the first response', async () => {
    const { app, issuer } = setUp()
    const statement = await create(app)

    const first = await issue(app, 'k-issue', statement)
    await app.json('POST', `/tax-invoices/${first.body.id}:sync`)
    const replay = await issue(app, 'k-issue', statement)

    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ status: 'ISSUED', detailSynced: false })
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(first.body)
    expect(issuer.issued).toHaveLength(1)
  })

  it('rejects the same key for another statement', async () => {
    const { app, issuer } = setUp()
    const a = await create(app)
    const b = await create(app)

    await issue(app, 'k-issue-body', a)
    const other = await issue(app, 'k-issue-body', b)

    expect(other.status).toBe(422)
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(issuer.calls).toHaveLength(1)
  })

  it('does not replay another user’s invoice and forgets the key after 24 hours', async () => {
    const { app, clock, issuer } = setUp()
    const statement = await create(app)

    await issue(app, 'k-issue-scope', statement)
    const theirs = await issue(app, 'k-issue-scope', statement, 'other')
    clock.ms = DAY_MS - 1000
    const replay = await issue(app, 'k-issue-scope', statement)
    clock.ms = DAY_MS + 1000
    const later = await issue(app, 'k-issue-scope', statement)

    expect(theirs.status).toBe(409)
    expect(theirs.body).toMatchObject({ code: 'SALES_TRANSACTION_LOCKED', lock: 'ISSUED' })
    expect(replay.status).toBe(201)
    expect(later.status).toBe(409)
    expect(issuer.issued).toHaveLength(1)
  })

  it('issues once while the first request is still waiting for Hometax', async () => {
    const { app, issuer } = setUp()
    const statement = await create(app)
    issuer.delayMs = 50

    const [a, b] = await Promise.all([issue(app, 'k-issue-race', statement), issue(app, 'k-issue-race', statement)])

    const conflict = [a, b].find((response) => response.status === 409)
    if (conflict !== undefined) {
      expect([a.status, b.status].sort()).toEqual([201, 409])
      expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' })
    } else {
      expect(a.body).toEqual(b.body)
    }
    expect(issuer.issued).toHaveLength(1)
  })

  it('asks Hometax again with the same key after a rejection', async () => {
    const { app, issuer } = setUp()
    const statement = await create(app, { buyer: party(FAKE_REJECTED_BUYER_NUMBER, '없는 회사') })

    const rejected = await issue(app, 'k-issue-fix', statement)
    await app.json('PATCH', `/sales-transactions/${statement}`, {
      body: { buyer: party('1108100011', '에코프로비엠') },
    })
    const fixed = await issue(app, 'k-issue-fix', statement)

    expect(rejected.status).toBe(422)
    expect(rejected.body).toMatchObject({ code: 'TAX_INVOICE_REJECTED' })
    expect(fixed.status).toBe(201)
    expect(fixed.body).toMatchObject({ status: 'ISSUED' })
    expect(new Set(issuer.calls).size).toBe(2)
  })

  it('finishes an issue whose result was lost with the same reference, without issuing twice', async () => {
    const { app, issuer } = setUp()
    const statement = await create(app)
    issuer.dieAfterIssuing = true

    const lost = await issue(app, 'k-issue-lost', statement)
    const pending = await app.json('GET', `/tax-invoices?salesTransactionId=${statement}`)
    const edit = await app.json('PATCH', `/sales-transactions/${statement}`, { body: { note: '수정' } })
    const resumed = await issue(app, 'k-issue-lost', statement)
    const listed = await app.json('GET', `/tax-invoices?salesTransactionId=${statement}`)

    expect(lost.status).toBe(503)
    expect(lost.body).toMatchObject({ code: 'EXTERNAL_OUTCOME_UNKNOWN' })
    expect(pending.body.items).toEqual([expect.objectContaining({ status: 'ISSUING' })])
    expect(edit.status).toBe(409)
    expect(edit.body).toMatchObject({ code: 'SALES_TRANSACTION_LOCKED', lock: 'ISSUING' })
    expect(resumed.status).toBe(201)
    expect(resumed.body).toMatchObject({ id: pending.body.items[0].id, status: 'ISSUED' })
    expect(listed.body.items).toEqual([resumed.body])
    expect(issuer.issued).toHaveLength(1)
    expect(issuer.calls).toEqual([issuer.issued[0], issuer.issued[0]])
  })
})
