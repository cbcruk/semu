import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { httpTestApp, type HttpTestApp } from '../../../shared/testing/http-test-app.ts'
import { DAY_MS, shiftableClock } from '../../../shared/testing/shiftable-clock.ts'
import { testActor } from '../../identity-access/testing.ts'
import { BookkeepingPortFakesLive } from '../bookkeeping.layer.ts'
import { EvidenceRepository } from '../common/repositories.ts'
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

/**
 * 증빙 저장소입니다. `dieOnSave`가 참이면 다음 저장 한 번이 결함으로 죽습니다. 발급 건을 `ISSUED`로 저장한 뒤 증빙을 만들다 멈춘 경우를
 * 만듭니다. 이 테스트에서만 메모리 표를 씁니다.
 */
function flakyEvidence(control: { dieOnSave: boolean }) {
  return Layer.effect(
    EvidenceRepository,
    Effect.map(
      Effect.gen(function* () {
        return yield* EvidenceRepository
      }),
      (inner) =>
        EvidenceRepository.of({
          ...inner,
          save: (row) => {
            if (!control.dieOnSave) return inner.save(row)
            control.dieOnSave = false
            return Effect.die(new Error('evidence store went away'))
          },
        }),
    ),
  ).pipe(Layer.provide(EvidenceRepository.layerMemory()))
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
  evidence: { dieOnSave: boolean }
}

let fixture: Fixture | null = null

afterEach(async () => {
  await fixture?.app.dispose()
  fixture = null
})

function setUp(options: { flakyEvidence?: boolean } = {}): Fixture {
  const clock = { ms: 0 }
  const issuer: IssuerControl = { calls: [], issued: [], delayMs: 0, dieAfterIssuing: false }
  const evidence = { dieOnSave: false }
  const app = httpTestApp({
    tokens: [
      ['admin', testActor()],
      ['other', testActor({ userId: OTHER_USER_ID })],
    ],
    layers: [
      BookkeepingPortFakesLive,
      controlledIssuer(issuer),
      shiftableClock(clock),
      ...(options.flakyEvidence === true ? [flakyEvidence(evidence)] : []),
    ],
    basePath: '/v1',
    defaultToken: 'admin',
  })
  fixture = { app, clock, issuer, evidence }
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

describe('전자세금계산서 발급 멱등성 POST /tax-invoices', () => {
  it('한 번만 발급하고 같은 키에는 첫 응답을 다시 돌려줍니다', async () => {
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

  it('같은 키를 다른 거래명세서에 쓰면 거절합니다', async () => {
    const { app, issuer } = setUp()
    const a = await create(app)
    const b = await create(app)

    await issue(app, 'k-issue-body', a)
    const other = await issue(app, 'k-issue-body', b)

    expect(other.status).toBe(422)
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(issuer.calls).toHaveLength(1)
  })

  it('다른 사용자의 발급은 다시 돌려주지 않고, 24시간이 지나면 키를 잊습니다', async () => {
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

  it('첫 요청이 홈택스 응답을 기다리는 동안에도 한 번만 발급합니다', async () => {
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

  it('거절된 뒤 같은 키로 보내면 홈택스에 다시 요청합니다', async () => {
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

  it('결과를 잃은 발급은 같은 참조로 마무리하고 두 번 발급하지 않습니다', async () => {
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

  it('확인되지 않은 발급은 24시간이 지나도 남겨 같은 참조로 마무리합니다', async () => {
    const { app, clock, issuer } = setUp()
    const statement = await create(app)
    issuer.dieAfterIssuing = true

    const lost = await issue(app, 'k-issue-late', statement)
    clock.ms = DAY_MS + 60 * 60 * 1000
    const resumed = await issue(app, 'k-issue-late', statement)
    const replay = await issue(app, 'k-issue-late', statement)

    expect(lost.status).toBe(503)
    expect(resumed.status).toBe(201)
    expect(resumed.body).toMatchObject({ status: 'ISSUED' })
    expect(replay.body).toEqual(resumed.body)
    expect(issuer.issued).toHaveLength(1)
    expect(issuer.calls).toEqual([issuer.issued[0], issuer.issued[0]])
  })

  it('확인되지 않은 발급은 다른 사용자가 다른 키로 마무리할 수 있고 거래명세서를 잠가 두지 않습니다', async () => {
    const { app, issuer } = setUp()
    const statement = await create(app)
    issuer.dieAfterIssuing = true

    const lost = await issue(app, 'k-issue-mine', statement)
    const theirs = await issue(app, 'k-issue-theirs', statement, 'other')
    const mine = await issue(app, 'k-issue-mine', statement)
    const listed = await app.json('GET', `/tax-invoices?salesTransactionId=${statement}`)
    const evidence = await app.json('GET', '/evidence?side=SALES&source=TAX_INVOICE')

    expect(lost.status).toBe(503)
    expect(theirs.status).toBe(201)
    expect(theirs.body).toMatchObject({ status: 'ISSUED' })
    expect(mine.status).toBe(201)
    expect(mine.body).toEqual(theirs.body)
    expect(listed.body.items).toEqual([theirs.body])
    expect(issuer.issued).toHaveLength(1)
    expect(new Set(issuer.calls).size).toBe(1)
    const rows = evidence.body.items.filter(
      (row: { salesTransactionId: string | null }) => row.salesTransactionId === statement,
    )
    expect(rows).toHaveLength(1)
  })

  it('발급 완료로 저장한 뒤 멈춘 발급은 빠진 매출 증빙을 만들어 마무리합니다', async () => {
    const { app, issuer, evidence } = setUp({ flakyEvidence: true })
    const statement = await create(app)
    evidence.dieOnSave = true

    const lost = await issue(app, 'k-issue-evidence', statement)
    const saved = await app.json('GET', `/tax-invoices?salesTransactionId=${statement}`)
    const before = await app.json('GET', '/evidence?side=SALES&source=TAX_INVOICE')
    const resumed = await issue(app, 'k-issue-evidence', statement)
    const after = await app.json('GET', '/evidence?side=SALES&source=TAX_INVOICE')

    const ofStatement = (body: { items: Array<{ salesTransactionId: string | null }> }) =>
      body.items.filter((row) => row.salesTransactionId === statement)
    expect(lost.status).toBe(503)
    expect(saved.body.items).toEqual([expect.objectContaining({ status: 'ISSUED' })])
    expect(ofStatement(before.body)).toHaveLength(0)
    expect(resumed.status).toBe(201)
    expect(resumed.body).toEqual(saved.body.items[0])
    expect(ofStatement(after.body)).toHaveLength(1)
    expect(issuer.issued).toHaveLength(1)
  })
})
