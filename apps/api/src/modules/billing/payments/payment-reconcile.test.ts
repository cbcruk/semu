import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { testActor } from '../../identity-access/testing.ts'
import { BillingMemoryLive } from '../billing.layer.ts'
import { DEMO_MANDATE_ID, DEMO_PAYMENT_IDS } from '../billing-seed.ts'
import { BillingMandates } from '../mandates/billing-mandates.ts'
import { Subscriptions } from '../subscriptions/subscriptions.ts'
import { PaymentRepository } from './payment-repository.ts'
import { Payments } from './payments.ts'

const agent = testActor({ companyId: DEMO_COMPANY_IDS.corporation, kind: 'AGENCY' })

const layer = Layer.mergeAll(Subscriptions.layer, BillingMandates.layer).pipe(
  Layer.provideMerge(Payments.layer),
  Layer.provideMerge(BillingMemoryLive),
)

/** 11월 출금일(25일)의 이틀 전, 결제 예정을 만드는 기간입니다. */
const run = <A, E>(effect: Effect.Effect<A, E, Subscriptions | BillingMandates | PaymentRepository>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse('2026-11-23T10:00:00+09:00'))
      return yield* effect
    }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
  )

const novemberPayroll = Effect.gen(function* () {
  const all = yield* (yield* PaymentRepository).listByCompany(DEMO_COMPANY_IDS.corporation)
  return all.filter((row) => row.plan === 'PAYROLL' && row.scheduledOn === '2026-11-25')
})

const payrollSubscription = Effect.gen(function* () {
  const all = yield* (yield* Subscriptions).list(agent)
  return all.find((row) => row.plan === 'PAYROLL')!
})

describe('구독·출금 동의를 바꾸면 결제 예정을 다시 맞춤', () => {
  it('출금일 전으로 해지하면 결제 예정을 취소하고, 해지를 거두면 다시 만듭니다', async () => {
    const [afterCancel, afterResume] = await run(
      Effect.gen(function* () {
        const subscriptions = yield* Subscriptions
        const subscription = yield* payrollSubscription
        yield* subscriptions.change(agent, subscription.id, 'CANCEL', { endsOn: '2026-11-24' })
        const canceled = yield* novemberPayroll
        yield* subscriptions.change(agent, subscription.id, 'RESUME', {})
        return [canceled, yield* novemberPayroll] as const
      }),
    )

    expect(afterCancel).toMatchObject([{ id: DEMO_PAYMENT_IDS.scheduled, status: 'CANCELED', version: 2 }])
    expect(afterResume.map((row) => row.status).toSorted()).toEqual(['CANCELED', 'SCHEDULED'])
    expect(afterResume.find((row) => row.status === 'SCHEDULED')).toMatchObject({ mandateId: DEMO_MANDATE_ID })
  })

  it('종료일이 출금일 뒤인 해지 예약은 결제 예정을 그대로 둡니다', async () => {
    const payments = await run(
      Effect.gen(function* () {
        const subscription = yield* payrollSubscription
        yield* (yield* Subscriptions).change(agent, subscription.id, 'CANCEL', { endsOn: '2026-11-30' })
        return yield* novemberPayroll
      }),
    )

    expect(payments).toMatchObject([{ id: DEMO_PAYMENT_IDS.scheduled, status: 'SCHEDULED', version: 1 }])
  })

  it('출금 계좌를 새로 등록하면 결제 예정의 출금 계좌를 바꿉니다', async () => {
    const [mandateId, payments] = await run(
      Effect.gen(function* () {
        const mandate = yield* (yield* BillingMandates).register(
          agent,
          { bankCode: '004', accountNumber: '123-456-789012', accountHolder: '세무상사', payerNumber: '1234567890' },
          'mandate-1',
        )
        return [mandate.id, yield* novemberPayroll] as const
      }),
    )

    expect(mandateId).not.toBe(DEMO_MANDATE_ID)
    expect(payments).toMatchObject([{ id: DEMO_PAYMENT_IDS.scheduled, status: 'SCHEDULED', mandateId }])
  })
})
