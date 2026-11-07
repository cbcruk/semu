import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { httpTestApp, type HttpTestApp } from '../../../shared/testing/http-test-app.ts'
import { DAY_MS, shiftableClock } from '../../../shared/testing/shiftable-clock.ts'
import { testActor } from '../../identity-access/testing.ts'
import { BookkeepingPortFakesLive } from '../bookkeeping.layer.ts'
import { FAKE_WRONG_PASSWORD, GiroPaymentGateway, type GiroPaymentResult } from '../ports/giro-payment-gateway.ts'

const OTHER_USER_ID = 'usr_01JBQ000000000000000000002' as Id<'user'>
const VAT = 'gir_01JBQ000000000000000000001'
const PAYMENT = { bankCode: '004', accountNumber: '123-456-789012', accountPassword: '1234' }

/**
 * 납부 게이트웨이 가짜입니다. 참조(`idempotencyKey`)마다 한 번만 출금하고(`withdrawn`), 같은 참조가 다시 오면 처음 결과를 돌려줍니다.
 * `dieAfterWithdrawing`이 참이면 다음 납부는 출금한 뒤 응답 없이 결함으로 끝납니다. 비밀번호가 틀리면 거절합니다.
 */
interface GatewayControl {
  calls: string[]
  withdrawn: string[]
  delayMs: number
  dieAfterWithdrawing: boolean
}

function controlledGateway(control: GatewayControl) {
  const results = new Map<string, GiroPaymentResult>()
  return Layer.succeed(
    GiroPaymentGateway,
    GiroPaymentGateway.of({
      pay: (request) =>
        Effect.gen(function* () {
          control.calls.push(request.idempotencyKey)
          if (control.delayMs > 0) yield* Effect.sleep(control.delayMs)
          const known = results.get(request.idempotencyKey)
          if (known !== undefined) return known
          if (request.accountPassword === FAKE_WRONG_PASSWORD) {
            const rejected = { ok: false, resultCode: 'E101', resultMessage: '계좌 비밀번호가 일치하지 않습니다.' }
            results.set(request.idempotencyKey, rejected)
            return rejected
          }
          const paid = { ok: true, resultCode: '0000', resultMessage: '정상 처리되었습니다.' }
          results.set(request.idempotencyKey, paid)
          control.withdrawn.push(request.idempotencyKey)
          if (control.dieAfterWithdrawing) {
            control.dieAfterWithdrawing = false
            return yield* Effect.die(new Error('bank connection reset'))
          }
          return paid
        }),
    }),
  )
}

interface Fixture {
  app: HttpTestApp
  clock: { ms: number }
  gateway: GatewayControl
}

let fixture: Fixture | null = null

afterEach(async () => {
  await fixture?.app.dispose()
  fixture = null
})

function setUp(): Fixture {
  const clock = { ms: 0 }
  const gateway: GatewayControl = { calls: [], withdrawn: [], delayMs: 0, dieAfterWithdrawing: false }
  const app = httpTestApp({
    tokens: [
      ['admin', testActor()],
      ['other', testActor({ userId: OTHER_USER_ID })],
    ],
    layers: [BookkeepingPortFakesLive, controlledGateway(gateway), shiftableClock(clock)],
    basePath: '/v1',
    defaultToken: 'admin',
  })
  fixture = { app, clock, gateway }
  return fixture
}

function pay(app: HttpTestApp, key: string, body: object = PAYMENT, token?: string) {
  return app.json('POST', `/giros/${VAT}:pay`, { idempotencyKey: key, body, token })
}

describe('POST /giros/{id}:pay idempotency', () => {
  it('pays once and replays the first response', async () => {
    const { app, gateway } = setUp()

    const first = await pay(app, 'k-pay')
    const replay = await pay(app, 'k-pay')

    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'DONE', doneReason: 'PAID_IN_APP' })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(replay.headers.get('etag')).toBe(first.headers.get('etag'))
    expect(gateway.withdrawn).toHaveLength(1)
  })

  it('rejects the same key with another account', async () => {
    const { app, gateway } = setUp()

    await pay(app, 'k-pay-body')
    const other = await pay(app, 'k-pay-body', { ...PAYMENT, accountNumber: '123-456-781111' })

    expect(other.status).toBe(422)
    expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(gateway.calls).toHaveLength(1)
  })

  it('does not replay another user’s payment and forgets the key after 24 hours', async () => {
    const { app, clock, gateway } = setUp()

    await pay(app, 'k-pay-scope')
    const theirs = await pay(app, 'k-pay-scope', PAYMENT, 'other')
    clock.ms = DAY_MS - 1000
    const replay = await pay(app, 'k-pay-scope')
    clock.ms = DAY_MS + 1000
    const later = await pay(app, 'k-pay-scope')

    expect(theirs.status).toBe(409)
    expect(theirs.body).toMatchObject({ code: 'GIRO_TRANSITION_INVALID', currentStatus: 'DONE' })
    expect(replay.status).toBe(200)
    expect(later.status).toBe(409)
    expect(gateway.withdrawn).toHaveLength(1)
  })

  it('pays once while the first request is still waiting for the bank', async () => {
    const { app, gateway } = setUp()
    gateway.delayMs = 50

    const [a, b] = await Promise.all([pay(app, 'k-pay-race'), pay(app, 'k-pay-race')])

    const conflict = [a, b].find((response) => response.status === 409)
    if (conflict !== undefined) {
      expect([a.status, b.status].sort()).toEqual([200, 409])
      expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' })
    } else {
      expect(a.body).toEqual(b.body)
    }
    expect(gateway.withdrawn).toHaveLength(1)
  })

  it('asks the bank again with the same key after a rejection', async () => {
    const { app, gateway } = setUp()

    const rejected = await pay(app, 'k-pay-fix', { ...PAYMENT, accountPassword: FAKE_WRONG_PASSWORD })
    const fixed = await pay(app, 'k-pay-fix')

    expect(rejected.status).toBe(422)
    expect(rejected.body).toMatchObject({ code: 'GIRO_PAYMENT_FAILED', resultCode: 'E101' })
    expect(fixed.status).toBe(200)
    expect(fixed.body).toMatchObject({ status: 'DONE' })
    expect(new Set(gateway.calls).size).toBe(2)
    expect(fixed.body.history.map((entry: { type: string }) => entry.type)).toEqual([
      'CREATED',
      'PAYMENT_FAILED',
      'PAID',
    ])
  })

  it('finishes a payment whose result was lost with the same reference, without paying twice', async () => {
    const { app, gateway } = setUp()
    gateway.dieAfterWithdrawing = true

    const lost = await pay(app, 'k-pay-lost')
    const open = await app.json('GET', `/giros/${VAT}`)
    const resumed = await pay(app, 'k-pay-lost')
    const replay = await pay(app, 'k-pay-lost')

    expect(lost.status).toBe(503)
    expect(lost.body).toMatchObject({ code: 'EXTERNAL_OUTCOME_UNKNOWN' })
    expect(open.body).toMatchObject({ status: 'TODO' })
    expect(resumed.status).toBe(200)
    expect(resumed.body).toMatchObject({ status: 'DONE', doneReason: 'PAID_IN_APP' })
    expect(replay.body).toEqual(resumed.body)
    expect(gateway.withdrawn).toHaveLength(1)
    expect(gateway.calls).toEqual([gateway.withdrawn[0], gateway.withdrawn[0]])
  })

  it('keeps an unconfirmed payment past 24 hours, so the same key never pays twice', async () => {
    const { app, clock, gateway } = setUp()
    gateway.dieAfterWithdrawing = true

    const lost = await pay(app, 'k-pay-late')
    clock.ms = DAY_MS + 60 * 60 * 1000
    const resumed = await pay(app, 'k-pay-late')
    const otherBody = await pay(app, 'k-pay-late', { ...PAYMENT, bankCode: '088' })

    expect(lost.status).toBe(503)
    expect(resumed.status).toBe(200)
    expect(resumed.body).toMatchObject({ status: 'DONE', doneReason: 'PAID_IN_APP' })
    expect(otherBody.status).toBe(422)
    expect(gateway.withdrawn).toHaveLength(1)
    expect(gateway.calls).toEqual([gateway.withdrawn[0], gateway.withdrawn[0]])
  })

  it('forgets an unconfirmed payment once its retry finds the bill already settled', async () => {
    const { app, gateway } = setUp()
    gateway.dieAfterWithdrawing = true

    const lost = await pay(app, 'k-pay-settled')
    await app.json('POST', `/giros/${VAT}:mark-paid`, { body: { memo: '은행에서 확인' } })
    const resumed = await pay(app, 'k-pay-settled')
    // 기록이 지워졌으면 본문이 달라도 422가 아니라 다시 처리해 고지서 상태(409)를 봅니다.
    const otherBody = await pay(app, 'k-pay-settled', { ...PAYMENT, bankCode: '088' })

    expect(lost.status).toBe(503)
    expect(resumed.status).toBe(409)
    expect(resumed.body).toMatchObject({ code: 'GIRO_TRANSITION_INVALID', currentStatus: 'DONE' })
    expect(otherBody.status).toBe(409)
    expect(otherBody.body).toMatchObject({ code: 'GIRO_TRANSITION_INVALID' })
  })
})
