import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { demoIntegrations } from '../demo-seed.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { scheduledScrapTask } from './scheduled-scrap-task.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import { scheduledScraps } from './scrap-schedule.ts'
import { ScrapRequests } from './scrap-requests.ts'
import { ScrapQueue } from './scrap-worker.ts'

const OTHER_COMPANY = 'cmp_01JBQ00000000000000000000Z' as Id<'company'>

function layerWith(enqueued: Array<Id<'scrapRequest'>>) {
  return ScrapRequests.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        IntegrationRepository.layerMemory(demoIntegrations()),
        ScrapRequestRepository.layerMemory(),
        ScrapQueue.layerManual(enqueued),
      ),
    ),
  )
}

describe('정기 수집 시각표', () => {
  it('PG는 10시·22시, 배달은 10시, 올라는 6시에 돌고 나머지 기관은 정기 수집이 없습니다', () => {
    expect(scheduledScraps()).toEqual([
      { name: 'integrations.scrap.pg-1000', institutionType: 'PG', at: '10:00' },
      { name: 'integrations.scrap.pg-2200', institutionType: 'PG', at: '22:00' },
      { name: 'integrations.scrap.delivery-1000', institutionType: 'DELIVERY', at: '10:00' },
      { name: 'integrations.scrap.allra-0600', institutionType: 'ALLRA', at: '06:00' },
    ])
  })
})

describe('ScrapRequests.requestScheduled', () => {
  it('시스템 요청은 쿨다운을 남기지 않고, 같은 슬롯은 다시 만들지 않으며, 진행 중이면 건너뜁니다', async () => {
    const enqueued: Array<Id<'scrapRequest'>> = []
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ScrapRequests
        const repository = yield* ScrapRequestRepository
        const first = yield* service.requestScheduled(TEST_COMPANY_ID, 'BANK', '2026-11-14T10:00')
        const replay = yield* service.requestScheduled(TEST_COMPANY_ID, 'BANK', '2026-11-14T10:00')
        const running = yield* service.requestScheduled(TEST_COMPANY_ID, 'BANK', '2026-11-14T22:00')
        const notConnected = yield* service.requestScheduled(OTHER_COMPANY, 'BANK', '2026-11-14T10:00')
        const saved = yield* repository.listByCompany(TEST_COMPANY_ID)
        return { first, replay, running, notConnected, saved }
      }).pipe(Effect.provide(layerWith(enqueued))),
    )

    expect([result.first, result.replay, result.running, result.notConnected]).toEqual([
      'CREATED',
      'REPLAYED',
      'RUNNING',
      'NOT_CONNECTED',
    ])
    expect(result.saved).toHaveLength(1)
    expect(result.saved[0]).toMatchObject({
      requester: 'SYSTEM',
      status: 'QUEUED',
      idempotencyKey: 'schedule:2026-11-14T10:00#BANK',
    })
    expect(result.saved[0]).not.toHaveProperty('requestedBy')
    expect(result.saved[0]).not.toHaveProperty('nextAvailableAt')
    expect(enqueued).toEqual([result.saved[0]?.id])
  })

  it('사용자 수동 수집의 쿨다운 중에도 앞 요청이 끝났으면 정기 수집을 만듭니다', async () => {
    const enqueued: Array<Id<'scrapRequest'>> = []
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ScrapRequests
        const repository = yield* ScrapRequestRepository
        const manual = yield* service.request(testActor(), { institutionType: 'BANK' }, 'key-1')
        const record = yield* repository.find(TEST_COMPANY_ID, manual.id)
        if (record._tag === 'Some') yield* repository.save({ ...record.value, status: 'SUCCEEDED' })
        const blocked = yield* Effect.flip(service.request(testActor(), { institutionType: 'BANK' }, 'key-2'))
        const scheduled = yield* service.requestScheduled(TEST_COMPANY_ID, 'BANK', '2026-11-14T10:00')
        return { blocked: blocked._tag, scheduled }
      }).pipe(Effect.provide(layerWith(enqueued))),
    )

    expect(outcome).toEqual({ blocked: 'ScrapRequestTooSoon', scheduled: 'CREATED' })
    expect(enqueued).toHaveLength(2)
  })
})

describe('정기 작업 integrations.scrap', () => {
  it('슬롯마다 그 기관 연동이 있는 회사에 시스템 수집을 요청하고, 앞 요청이 진행 중이면 건너뜁니다', async () => {
    const enqueued: Array<Id<'scrapRequest'>> = []
    const task = scheduledScrapTask({ name: 'integrations.scrap.bank-1000', institutionType: 'BANK', at: '10:00' })
    const layer = Scheduler.layer([task]).pipe(
      Layer.provideMerge(layerWith(enqueued)),
      Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
    )

    const runs = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* Scheduler
        yield* TestClock.setTime(Date.parse('2026-11-14T09:59:00+09:00'))
        yield* scheduler.runDue()
        yield* TestClock.setTime(Date.parse('2026-11-14T10:00:00+09:00'))
        yield* scheduler.runDue()
        return yield* scheduler.runs()
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(runs.map((run) => [run.slot, run.status])).toEqual([
      ['2026-11-14T10:00', 'SUCCEEDED'],
      ['2026-11-13T10:00', 'SUCCEEDED'],
    ])
    expect(runs[0]?.result).toEqual({ companies: 1, RUNNING: 1 })
    expect(runs[1]?.result).toEqual({ companies: 1, CREATED: 1 })
    expect(enqueued).toHaveLength(1)
  })
})
