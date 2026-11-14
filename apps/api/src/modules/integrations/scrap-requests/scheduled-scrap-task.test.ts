import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { demoDelegations, demoIntegrations } from '../demo-seed.ts'
import { DelegationRepository } from '../hometax-delegations/hometax-delegation.ts'
import type { DelegationRecord } from '../hometax-delegations/hometax-delegation.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { isPausedForSchedule } from '../integrations/scrap-retry.ts'
import { scheduledScrapTask } from './scheduled-scrap-task.ts'
import { ScrapRequestRepository } from './scrap-request-repository.ts'
import { scheduledScraps } from './scrap-schedule.ts'
import { ScrapRequests } from './scrap-requests.ts'
import { ScrapQueue } from './scrap-worker.ts'

const OTHER_COMPANY = 'cmp_01JBQ00000000000000000000Z' as Id<'company'>

function layerWith(enqueued: Array<Id<'scrapRequest'>>, delegations: DelegationRecord[] = demoDelegations()) {
  return ScrapRequests.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        IntegrationRepository.layerMemory(demoIntegrations()),
        DelegationRepository.layerMemory(delegations),
        ScrapRequestRepository.layerMemory(),
        ScrapQueue.layerManual(enqueued),
      ),
    ),
  )
}

describe('정기 수집 시각표', () => {
  it('은행은 7시, 카드는 7시 반, 홈택스는 8시, PG는 10시·22시, 배달은 10시, 올라는 6시에 돌고 지로는 정기 수집이 없습니다', () => {
    expect(scheduledScraps()).toEqual([
      { name: 'integrations.scrap.hometax-0800', institutionType: 'HOMETAX', at: '08:00' },
      { name: 'integrations.scrap.card-sales-0730', institutionType: 'CARD_SALES', at: '07:30' },
      { name: 'integrations.scrap.credit-card-0730', institutionType: 'CREDIT_CARD', at: '07:30' },
      { name: 'integrations.scrap.bank-0700', institutionType: 'BANK', at: '07:00' },
      { name: 'integrations.scrap.speed-bank-0700', institutionType: 'SPEED_BANK', at: '07:00' },
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

  it('홈택스는 동의한 수임동의가 있는 회사만 정기 수집하고, 동의 대기·해지뿐이면 건너뜁니다', async () => {
    const enqueued: Array<Id<'scrapRequest'>> = []
    const agreed = demoDelegations().filter((delegation) => delegation.companyId === TEST_COMPANY_ID)
    const run = (delegations: DelegationRecord[]) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ScrapRequests).requestScheduled(TEST_COMPANY_ID, 'HOMETAX', '2026-11-14T08:00')
        }).pipe(Effect.provide(layerWith(enqueued, delegations))),
      )

    const outcomes = [
      await run(agreed.map((delegation) => ({ ...delegation, status: 'REQUESTED' as const }))),
      await run(agreed.map((delegation) => ({ ...delegation, status: 'REVOKED' as const }))),
      await run([]),
      await run(agreed),
    ]

    expect(agreed).toHaveLength(1)
    expect(outcomes).toEqual(['DELEGATION_REQUIRED', 'DELEGATION_REQUIRED', 'DELEGATION_REQUIRED', 'CREATED'])
    expect(enqueued).toHaveLength(1)
  })
})

describe('isPausedForSchedule', () => {
  it('마지막 수집이 재시도할 수 없게 실패했을 때만 정기 수집을 건너뜁니다', () => {
    expect(isPausedForSchedule(undefined)).toBe(false)
    expect(isPausedForSchedule({ status: 'SUCCEEDED', isRetryable: true })).toBe(false)
    expect(isPausedForSchedule({ status: 'FAILED', isRetryable: true })).toBe(false)
    expect(isPausedForSchedule({ status: 'FAILED', isRetryable: false })).toBe(true)
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
