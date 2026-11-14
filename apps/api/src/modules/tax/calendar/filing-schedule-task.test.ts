import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { FilingSchedulerLive, taxMemoryLayer } from '../tax.layer.ts'
import { filingScheduleTask } from './filing-schedule-task.ts'

describe('정기 작업 tax.filing-schedule', () => {
  it('매일 03:00에 세무 기장 회사의 신고 건을 만들고 같은 날은 다시 돌지 않습니다', async () => {
    const memory = taxMemoryLayer({ profiles: [DEMO_TAX_PROFILE] })
    const layer = Scheduler.layer([filingScheduleTask]).pipe(
      Layer.provideMerge(FilingSchedulerLive),
      Layer.provideMerge(memory),
      Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
    )

    const [first, again, runs, filings] = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse('2026-11-14T03:00:00+09:00'))
        const scheduler = yield* Scheduler
        const first = yield* scheduler.runDue()
        const again = yield* scheduler.runDue()
        return [first, again, yield* scheduler.runs(), yield* (yield* FilingRepository).list(TEST_COMPANY_ID)] as const
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(first).toEqual([{ task: 'tax.filing-schedule', slot: '2026-11-14T03:00', outcome: 'SUCCEEDED' }])
    expect(again[0]!.outcome).toBe('SKIPPED')
    expect(filings.length).toBeGreaterThan(0)
    expect(runs[0]).toMatchObject({
      status: 'SUCCEEDED',
      attempts: 1,
      result: { companies: 1, created: filings.length, refreshed: 0, restored: 0, canceled: 0 },
    })
  })
})
