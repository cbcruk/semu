import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { PaymentsLive, BillingMemoryStoreLive } from '../billing.layer.ts'
import { PaymentRepository } from './payment-repository.ts'
import { PublicHolidays } from './public-holidays.ts'
import { paymentScheduleTask } from './payment-schedule-task.ts'

describe('정기 작업 billing.payment-schedule', () => {
  it('매일 06:00에 다가오는 출금일의 결제 예정을 만들고 다음 날은 새로 만들 것이 없습니다', async () => {
    const layer = Scheduler.layer([paymentScheduleTask]).pipe(
      Layer.provideMerge(PaymentsLive),
      Layer.provideMerge(Layer.merge(BillingMemoryStoreLive, PublicHolidays.layerMemory())),
      Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
    )

    const [runs, december] = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* TestClock.setTime(Date.parse('2026-12-01T06:00:00+09:00'))
        yield* scheduler.runDue()
        yield* TestClock.setTime(Date.parse('2026-12-02T06:00:00+09:00'))
        yield* scheduler.runDue()
        const all = yield* (yield* PaymentRepository).listAll()
        return [yield* scheduler.runs(), all.filter((payment) => payment.scheduledOn === '2026-12-28')] as const
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(december.length).toBeGreaterThan(0)
    expect(runs.map((run) => [run.slot, run.status, run.result])).toEqual([
      ['2026-12-02T06:00', 'SUCCEEDED', { month: '2026-12', created: 0 }],
      ['2026-12-01T06:00', 'SUCCEEDED', { month: '2026-12', created: december.length }],
    ])
  })
})
