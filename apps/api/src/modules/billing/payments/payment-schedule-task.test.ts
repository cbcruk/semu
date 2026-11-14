import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { BillingMemoryStoreLive, PaymentsLive } from '../billing.layer.ts'
import { SubscriptionRepository } from '../subscriptions/subscription-repository.ts'
import { PaymentRepository } from './payment-repository.ts'
import { PublicHolidays } from './public-holidays.ts'
import { paymentScheduleTask } from './payment-schedule-task.ts'

const layer = () =>
  Scheduler.layer([paymentScheduleTask]).pipe(
    Layer.provideMerge(PaymentsLive),
    Layer.provideMerge(Layer.merge(BillingMemoryStoreLive, PublicHolidays.layerMemory())),
    Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
  )

const at = (local: string) => TestClock.setTime(Date.parse(`${local}+09:00`))

/** 12월 출금일(공휴일·주말을 건너 28일)의 결제 예정입니다. */
const decemberPayments = Effect.gen(function* () {
  const all = yield* (yield* PaymentRepository).listAll()
  return all.filter((payment) => payment.scheduledOn === '2026-12-28')
})

describe('정기 작업 billing.payment-schedule', () => {
  it('출금일 3일 전부터 결제 예정을 만들고 그 전이나 이미 만든 뒤에는 만들지 않습니다', async () => {
    const [runs, december] = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* at('2026-12-01T06:00:00')
        yield* scheduler.runDue()
        yield* at('2026-12-25T06:00:00')
        yield* scheduler.runDue()
        yield* at('2026-12-26T06:00:00')
        yield* scheduler.runDue()
        return [yield* scheduler.runs(), yield* decemberPayments] as const
      }).pipe(Effect.provide(layer()), Effect.provide(TestClock.layer())),
    )

    expect(december.length).toBeGreaterThan(0)
    expect(runs.map((run) => [run.slot, run.result])).toEqual([
      ['2026-12-26T06:00', { month: '2026-12', created: 0 }],
      ['2026-12-25T06:00', { month: '2026-12', created: december.length }],
      ['2026-12-01T06:00', { month: null, created: 0 }],
    ])
  })

  it('만들기 전에 해지한 구독은 결제 예정이 생기지 않습니다', async () => {
    const [december, canceledId] = await Effect.runPromise(
      Effect.gen(function* () {
        const subscriptions = yield* SubscriptionRepository
        const active = (yield* subscriptions.listAll()).find((row) => row.status === 'ACTIVE' && row.monthlyFee > 0)!
        // 12월 10일에 담당자가 12월 15일 해지로 바꿨습니다.
        yield* at('2026-12-10T10:00:00')
        yield* subscriptions.save({ ...active, status: 'CANCELLATION_SCHEDULED', endsOn: '2026-12-15' })
        yield* at('2026-12-25T06:00:00')
        yield* (yield* Scheduler).runDue()
        return [yield* decemberPayments, active.id] as const
      }).pipe(Effect.provide(layer()), Effect.provide(TestClock.layer())),
    )

    expect(december.length).toBeGreaterThan(0)
    expect(december.map((payment) => payment.subscriptionId)).not.toContain(canceledId)
  })
})
