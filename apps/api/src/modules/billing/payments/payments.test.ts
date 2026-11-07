import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BillingIdempotency } from '../billing-idempotency.ts'
import { demoMandates, DEMO_PAYMENT_IDS, demoPayments, demoSubscriptions } from '../billing-seed.ts'
import { BillingMandateRepository } from '../mandates/billing-mandate-repository.ts'
import { SubscriptionRepository } from '../subscriptions/subscription-repository.ts'
import { PaymentRepository } from './payment-repository.ts'
import { Payments } from './payments.ts'
import { PublicHolidays } from './public-holidays.ts'

const company = 'cmp_01JBQ000000000000000000009' as Id<'company'>

const layer = Payments.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      PaymentRepository.layerMemory(demoPayments()),
      SubscriptionRepository.layerMemory([
        ...demoSubscriptions(),
        {
          id: 'sub_01JBQ000000000000000000099' as Id<'subscription'>,
          companyId: company,
          plan: 'PAYROLL',
          status: 'ACTIVE',
          startsOn: '2026-01-01',
          monthlyFee: 330000,
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 1,
        },
      ]),
      BillingMandateRepository.layerMemory(demoMandates()),
      PublicHolidays.layerMemory(),
      BillingIdempotency.layerMemory,
    ),
  ),
)

const run = <A>(effect: Effect.Effect<A, never, Payments | PaymentRepository>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, layer))

describe('Payments.scheduleMonth', () => {
  it('creates one payment per billable subscription on the shifted billing day, once', async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const payments = yield* Payments
        return [yield* payments.scheduleMonth('2026-12'), yield* payments.scheduleMonth('2026-12')] as const
      }),
    )

    expect(first.find((row) => row.companyId === company)).toMatchObject({
      scheduledOn: '2026-12-28',
      amount: 330000,
      status: 'SCHEDULED',
    })
    expect(first.every((row) => row.number > 1006)).toBe(true)
    expect(new Set(first.map((row) => row.number)).size).toBe(first.length)
    expect(second).toEqual([])
  })

  it('does not schedule a month already scheduled in the seed', async () => {
    const created = await run(Effect.flatMap(Payments, (payments) => payments.scheduleMonth('2026-11')))

    expect(created.some((row) => row.subscriptionId === demoPayments()[0]?.subscriptionId)).toBe(false)
  })
})

describe('Payments.recordWithdrawal', () => {
  it('settles a scheduled payment and ignores a repeated result', async () => {
    const [paid, repeated] = await run(
      Effect.gen(function* () {
        const payments = yield* Payments
        const first = yield* payments.recordWithdrawal(DEMO_PAYMENT_IDS.scheduled, { succeeded: true })
        const again = yield* payments.recordWithdrawal(DEMO_PAYMENT_IDS.scheduled, { succeeded: true })
        return [first, again] as const
      }),
    )

    expect(Option.getOrThrow(paid)).toMatchObject({ status: 'PAID', version: 2 })
    expect(Option.getOrThrow(repeated)).toMatchObject({ status: 'PAID', version: 2 })
  })

  it('records the failure reason', async () => {
    const failed = await run(
      Effect.flatMap(Payments, (payments) =>
        payments.recordWithdrawal(DEMO_PAYMENT_IDS.scheduled, { succeeded: false, failureReason: 'ACCOUNT_CLOSED' }),
      ),
    )

    expect(Option.getOrThrow(failed)).toMatchObject({ status: 'FAILED', failureReason: 'ACCOUNT_CLOSED' })
  })
})
