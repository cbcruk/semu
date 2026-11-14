import { Effect, Layer, Option } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../shared/ids/ids.types.ts'
import { httpTestApp, type HttpTestApp, type HttpTestJson } from '../../shared/testing/http-test-app.ts'
import { DAY_MS, shiftableClock } from '../../shared/testing/shiftable-clock.ts'
import { testActor } from '../identity-access/testing.ts'
import { DEMO_PAYMENT_IDS } from './billing-seed.ts'
import { CmsGateway, type MandateRegistrationResult } from './mandates/cms-gateway.ts'
import { PublicHolidays } from './payments/public-holidays.ts'

const OTHER_USER_ID = 'usr_01JBQ000000000000000000002' as Id<'user'>

/** 대리인 담당자 두 명(재시도·환불)과 고객 관리자 두 명(출금 계좌)입니다. 모두 같은 법인 회사입니다. */
const TOKENS = [
  ['agent', testActor({ kind: 'AGENCY' })],
  ['other-agent', testActor({ kind: 'AGENCY', userId: OTHER_USER_ID })],
  ['owner', testActor()],
  ['other-owner', testActor({ userId: OTHER_USER_ID })],
] as const

/**
 * CMS 게이트웨이 가짜입니다. `requestId`마다 은행에 한 번만 등록하고(`registered`), 같은 `requestId`가 다시 오면 처음 결과를 돌려줍니다.
 * `dieAfterRegistering`이 참이면 다음 등록은 은행에 등록한 뒤 응답 없이 결함으로 끝납니다. 계좌번호가 `0000`으로 끝나면 거절합니다.
 */
interface CmsControl {
  calls: string[]
  registered: string[]
  delayMs: number
  dieAfterRegistering: boolean
}

function controlledCms(control: CmsControl) {
  const results = new Map<string, MandateRegistrationResult>()
  return Layer.succeed(
    CmsGateway,
    CmsGateway.of({
      withdrawalResults: () => Effect.succeed(Option.none()),
      registerAccount: (input) =>
        Effect.gen(function* () {
          control.calls.push(input.requestId)
          if (control.delayMs > 0) yield* Effect.sleep(control.delayMs)
          const known = results.get(input.requestId)
          if (known !== undefined) return known
          const result: MandateRegistrationResult = input.accountNumber.endsWith('0000')
            ? { accepted: false, reason: 'ACCOUNT_NOT_FOUND' }
            : { accepted: true, reference: `cms-${input.requestId}` }
          results.set(input.requestId, result)
          control.registered.push(input.requestId)
          if (control.dieAfterRegistering) {
            control.dieAfterRegistering = false
            return yield* Effect.die(new Error('bank connection reset'))
          }
          return result
        }),
    }),
  )
}

/** 재시도가 부르는 공휴일 조회를 `delayMs`만큼 늦춥니다. 재시도를 처리 중인 동안 같은 키를 보내는 데 씁니다. */
function slowHolidays(control: { delayMs: number }) {
  return Layer.succeed(
    PublicHolidays,
    PublicHolidays.of({
      all: () => Effect.sleep(control.delayMs).pipe(Effect.as(new Set<string>())),
    }),
  )
}

interface Fixture {
  app: HttpTestApp
  clock: { ms: number }
  cms: CmsControl
  holidays: { delayMs: number }
}

let fixture: Fixture | null = null

afterEach(async () => {
  await fixture?.app.dispose()
  fixture = null
})

function setUp(): Fixture {
  const clock = { ms: 0 }
  const cms: CmsControl = { calls: [], registered: [], delayMs: 0, dieAfterRegistering: false }
  const holidays = { delayMs: 0 }
  const app = httpTestApp({
    tokens: TOKENS,
    layers: [controlledCms(cms), slowHolidays(holidays), shiftableClock(clock)],
    basePath: '/v1',
  })
  fixture = { app, clock, cms, holidays }
  return fixture
}

function retry(app: HttpTestApp, key: string, body: object = {}, options: { token?: string; ifMatch?: string } = {}) {
  return app.json('POST', `/payments/${DEMO_PAYMENT_IDS.failed}:retry`, {
    token: options.token ?? 'agent',
    idempotencyKey: key,
    ifMatch: options.ifMatch,
    body,
  })
}

function refund(app: HttpTestApp, key: string, options: { token?: string; ifMatch?: string } = {}) {
  return app.json('POST', `/payments/${DEMO_PAYMENT_IDS.paid}:refund`, {
    token: options.token ?? 'agent',
    idempotencyKey: key,
    ifMatch: options.ifMatch,
  })
}

const ACCOUNT = {
  bankCode: '004',
  accountNumber: '123-456-789012',
  accountHolder: '세무 카페',
  payerNumber: '1048145235',
}

function register(app: HttpTestApp, key: string, body: object = ACCOUNT, token = 'owner') {
  return app.json('POST', '/billing-mandates', { token, idempotencyKey: key, body })
}

/** 겹친 두 응답을 봅니다. 메모리 저장소는 처리 중인 키를 409로 막고, SQLite는 쓰기 잠금으로 줄을 세워 뒤 요청이 처음 응답을 받습니다. */
function expectOneProcessed(a: HttpTestJson, b: HttpTestJson, success: number) {
  const conflict = [a, b].find((response) => response.status === 409)
  if (conflict !== undefined) {
    expect([a.status, b.status].sort()).toEqual([success, 409].sort())
    expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' })
  } else {
    expect([a.status, b.status]).toEqual([success, success])
    expect(a.body).toEqual(b.body)
  }
}

describe('결제 재시도의 멱등성(POST /payments/{id}:retry)', () => {
  it('If-Match를 다시 보지 않고 첫 응답을 되돌려 줍니다', async () => {
    const { app } = setUp()

    const first = await retry(app, 'k-retry', { retryOn: '2099-01-03' }, { ifMatch: '"1"' })
    const replay = await retry(app, 'k-retry', { retryOn: '2099-01-03' }, { ifMatch: '"1"' })

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'RETRYING', version: 2 })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(replay.headers.get('etag')).toBe(first.headers.get('etag'))
  })

  it('같은 키로 본문이나 커맨드가 다르면 거부합니다', async () => {
    const { app } = setUp()

    await retry(app, 'k-retry-body', { retryOn: '2099-01-03' })
    const otherDate = await retry(app, 'k-retry-body', { retryOn: '2099-01-10' })
    const otherCommand = await refund(app, 'k-retry-body')

    expect(otherDate.status).toBe(422)
    expect(otherDate.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(otherCommand.status).toBe(422)
    const payment = await app.json('GET', `/payments/${DEMO_PAYMENT_IDS.failed}`, { token: 'agent' })
    expect(payment.body).toMatchObject({ scheduledOn: '2099-01-05', version: 2 })
  })

  it('같은 키라도 다른 사용자의 응답은 되돌려 주지 않습니다', async () => {
    const { app } = setUp()

    await retry(app, 'k-retry-scope', { retryOn: '2099-01-03' })
    const theirs = await retry(app, 'k-retry-scope', { retryOn: '2099-01-03' }, { token: 'other-agent' })

    expect(theirs.status).toBe(409)
    expect(theirs.body).toMatchObject({ code: 'PAYMENT_TRANSITION_INVALID', currentStatus: 'RETRYING' })
  })

  it('24시간 안에는 되돌려 주고 그 뒤에는 새 키로 봅니다', async () => {
    const { app, clock } = setUp()

    const first = await retry(app, 'k-retry-ttl', { retryOn: '2099-01-03' })
    clock.ms = DAY_MS - 1000
    const replay = await retry(app, 'k-retry-ttl', { retryOn: '2099-01-03' })
    clock.ms = DAY_MS + 1000
    const fresh = await retry(app, 'k-retry-ttl', { retryOn: '2099-01-03' })

    expect(replay.body).toEqual(first.body)
    expect(fresh.status).toBe(409)
    expect(fresh.body).toMatchObject({ code: 'PAYMENT_TRANSITION_INVALID' })
  })

  it('첫 요청이 처리 중이면 같은 키를 한 번만 처리합니다', async () => {
    const { app, holidays } = setUp()
    holidays.delayMs = 50

    const [a, b] = await Promise.all([
      retry(app, 'k-retry-race', { retryOn: '2099-01-03' }),
      retry(app, 'k-retry-race', { retryOn: '2099-01-03' }),
    ])

    expectOneProcessed(a, b, 200)
    const payment = await app.json('GET', `/payments/${DEMO_PAYMENT_IDS.failed}`, { token: 'agent' })
    expect(payment.body).toMatchObject({ version: 2 })
  })

  it('요청이 실패하면 키를 잡아 두지 않아 고친 뒤 같은 키로 다시 보낼 수 있습니다', async () => {
    const { app } = setUp()

    const stale = await retry(app, 'k-retry-fix', { retryOn: '2099-01-03' }, { ifMatch: '"9"' })
    const past = await retry(app, 'k-retry-fix', { retryOn: '2000-01-03' })
    const fixed = await retry(app, 'k-retry-fix', { retryOn: '2099-01-03' }, { ifMatch: '"1"' })

    expect(stale.status).toBe(412)
    expect(past.status).toBe(422)
    expect(past.body).toMatchObject({ code: 'RETRY_DATE_INVALID' })
    expect(fixed.status).toBe(200)
    expect(fixed.body).toMatchObject({ status: 'RETRYING', version: 2 })
  })
})

describe('환불의 멱등성(POST /payments/{id}:refund)', () => {
  it('같은 결제·같은 본문이라도 재시도 키를 다시 쓴 환불은 거부합니다', async () => {
    const { app } = setUp()

    const retried = await retry(app, 'k-retry-then-refund')
    const refunded = await app.json('POST', `/payments/${DEMO_PAYMENT_IDS.failed}:refund`, {
      token: 'agent',
      idempotencyKey: 'k-retry-then-refund',
    })

    expect(retried.status).toBe(200)
    expect(refunded.status).toBe(422)
    expect(refunded.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('첫 환불 응답을 되돌려 줍니다', async () => {
    const { app } = setUp()

    const first = await refund(app, 'k-refund', { ifMatch: '"1"' })
    const replay = await refund(app, 'k-refund', { ifMatch: '"1"' })

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'REFUNDED', refundedAt: expect.any(String) })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
  })

  it('같은 키로 다른 결제를 요청하면 거부합니다', async () => {
    const { app } = setUp()

    await refund(app, 'k-refund-body')
    const other = await app.json('POST', `/payments/${DEMO_PAYMENT_IDS.failed}:refund`, {
      token: 'agent',
      idempotencyKey: 'k-refund-body',
    })

    expect(other.status).toBe(422)
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('다른 사용자의 환불은 되돌려 주지 않고 24시간 뒤에는 키를 잊습니다', async () => {
    const { app, clock } = setUp()

    await refund(app, 'k-refund-scope')
    const theirs = await refund(app, 'k-refund-scope', { token: 'other-agent' })
    clock.ms = DAY_MS + 1000
    const later = await refund(app, 'k-refund-scope')

    expect(theirs.status).toBe(409)
    expect(theirs.body).toMatchObject({ code: 'PAYMENT_TRANSITION_INVALID', currentStatus: 'REFUNDED' })
    expect(later.status).toBe(409)
  })

  it('전제 조건 실패 뒤에는 같은 키로 다시 보낼 수 있습니다', async () => {
    const { app } = setUp()

    const stale = await refund(app, 'k-refund-fix', { ifMatch: '"9"' })
    const fixed = await refund(app, 'k-refund-fix', { ifMatch: '"1"' })

    expect(stale.status).toBe(412)
    expect(fixed.status).toBe(200)
  })
})

describe('결제 수단 등록의 멱등성(POST /billing-mandates)', () => {
  it('한 번만 등록하고 첫 응답을 되돌려 줍니다', async () => {
    const { app, cms } = setUp()

    const first = await register(app, 'k-mandate')
    const replay = await register(app, 'k-mandate')

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(first.body)
    expect(cms.registered).toHaveLength(1)
  })

  it('같은 키로 다른 계좌를 보내면 거부하고 첫 등록을 유지합니다', async () => {
    const { app, cms } = setUp()

    await register(app, 'k-mandate-body')
    const other = await register(app, 'k-mandate-body', { ...ACCOUNT, accountNumber: '123-456-781111' })

    expect(other.status).toBe(422)
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(cms.calls).toHaveLength(1)
  })

  it('키는 사용자마다 따로 두고 24시간 뒤에는 잊습니다', async () => {
    const { app, cms, clock } = setUp()

    const mine = await register(app, 'k-mandate-scope')
    const theirs = await register(app, 'k-mandate-scope', ACCOUNT, 'other-owner')
    clock.ms = DAY_MS - 1000
    const replay = await register(app, 'k-mandate-scope')
    clock.ms = DAY_MS + 1000
    const fresh = await register(app, 'k-mandate-scope')

    expect(theirs.status).toBe(201)
    expect(theirs.body.id).not.toBe(mine.body.id)
    expect(replay.body).toEqual(mine.body)
    expect(fresh.status).toBe(201)
    expect(fresh.body.id).not.toBe(mine.body.id)
    expect(cms.registered).toHaveLength(3)
  })

  it('첫 요청이 은행 응답을 기다리는 동안에도 한 번만 등록합니다', async () => {
    const { app, cms } = setUp()
    cms.delayMs = 50

    const [a, b] = await Promise.all([register(app, 'k-mandate-race'), register(app, 'k-mandate-race')])

    expectOneProcessed(a, b, 201)
    expect(cms.registered).toHaveLength(1)
  })

  it('거절된 뒤에는 같은 키로 은행에 다시 묻습니다', async () => {
    const { app, cms } = setUp()
    const closed = { ...ACCOUNT, accountNumber: '123-456-780000' }

    const rejected = await register(app, 'k-mandate-fix', closed)
    const again = await register(app, 'k-mandate-fix', closed)
    const fixed = await register(app, 'k-mandate-fix')

    expect(rejected.status).toBe(422)
    expect(rejected.body).toMatchObject({ code: 'MANDATE_REJECTED' })
    expect(again.status).toBe(422)
    expect(fixed.status).toBe(201)
    expect(new Set(cms.calls).size).toBe(3)
    const { body } = await app.json('GET', '/billing-mandates', { token: 'owner' })
    expect(body.items.filter((item: { status: string }) => item.status === 'REJECTED')).toHaveLength(2)
  })

  it('결과를 잃은 등록은 같은 요청 ID로 마무리하고 두 번 등록하지 않습니다', async () => {
    const { app, cms } = setUp()
    cms.dieAfterRegistering = true

    const lost = await register(app, 'k-mandate-lost')
    const reused = await register(app, 'k-mandate-lost', { ...ACCOUNT, accountHolder: '다른 예금주' })
    const resumed = await register(app, 'k-mandate-lost')
    const replay = await register(app, 'k-mandate-lost')

    expect(lost.status).toBe(503)
    expect(lost.body).toMatchObject({ code: 'EXTERNAL_OUTCOME_UNKNOWN' })
    expect(reused.status).toBe(422)
    expect(resumed.status).toBe(201)
    expect(replay.body).toEqual(resumed.body)
    expect(cms.registered).toHaveLength(1)
    expect(cms.calls).toEqual([cms.registered[0], cms.registered[0]])
    const { body } = await app.json('GET', '/billing-mandates', { token: 'owner' })
    expect(body.items.filter((item: { status: string }) => item.status === 'REGISTERED')).toEqual([resumed.body])
  })
})
