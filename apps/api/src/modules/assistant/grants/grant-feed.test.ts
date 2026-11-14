import { Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import { Scheduler } from '../../../shared/scheduler/scheduler.ts'
import { Grant } from './grant.ts'
import type { GrantRecord } from './grant.ts'
import { mergeGrantFeed } from './grant-feed.ts'
import type { GrantNotice } from './grant-feed.ts'
import { GrantFeedSource, GrantFeedUnavailable } from './grant-feed-source.ts'
import { grantFeedTask } from './grant-feed-task.ts'
import { GrantRepository } from './grant-repository.ts'

const notice = (externalId: string, overrides: Partial<GrantNotice> = {}): GrantNotice => ({
  source: 'BIZINFO',
  externalId,
  title: `공고 ${externalId}`,
  agency: '중소벤처기업부',
  summary: '요약',
  url: `https://example.com/${externalId}`,
  industryCodes: [],
  regionCodes: ['11'],
  applyStartOn: '2026-11-01',
  applyEndOn: '2026-12-31',
  ...overrides,
})

const ids = () => {
  let next = 0
  return () => `grt_${String(++next).padStart(26, '0')}` as Id<'grant'>
}

describe('공고 합치기', () => {
  it('처음 본 공고는 만들고, 같은 원천 번호는 내용이 바뀐 것만 같은 ID로 고칩니다', () => {
    const first = mergeGrantFeed([], [notice('A'), notice('B')], ids())
    const stored: GrantRecord[] = first.created
    const second = mergeGrantFeed(stored, [notice('A'), notice('B', { applyEndOn: '2027-01-31' }), notice('C')], ids())

    expect(first.created.map((grant) => grant.externalId)).toEqual(['A', 'B'])
    expect(second.updated).toEqual([{ ...notice('B', { applyEndOn: '2027-01-31' }), id: stored[1]!.id }])
    expect(second.created.map((grant) => grant.externalId)).toEqual(['C'])
  })

  it('원천에서 빠진 공고는 지우지 않고, 원천이 같은 공고를 두 번 주면 하나만 만듭니다', () => {
    const stored = mergeGrantFeed([], [notice('A')], ids()).created

    expect(mergeGrantFeed(stored, [], ids())).toEqual({ created: [], updated: [] })
    expect(mergeGrantFeed([], [notice('A'), notice('A')], ids()).created).toHaveLength(1)
  })

  it('원천이 달라도 번호가 같으면 다른 공고입니다', () => {
    const stored = mergeGrantFeed([], [notice('A')], ids()).created

    expect(mergeGrantFeed(stored, [notice('A', { source: 'K_STARTUP' })], ids()).created).toHaveLength(1)
  })
})

function runFeed(source: Layer.Layer<GrantFeedSource>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const scheduler = yield* Scheduler
      yield* TestClock.setTime(Date.parse('2026-11-15T04:00:00+09:00'))
      yield* scheduler.runDue()
      yield* TestClock.setTime(Date.parse('2026-11-16T04:00:00+09:00'))
      yield* scheduler.runDue()
      return [yield* scheduler.runs(), yield* (yield* GrantRepository).list()] as const
    }).pipe(
      Effect.provide(
        Scheduler.layer([grantFeedTask]).pipe(
          Layer.provideMerge(Layer.mergeAll(GrantRepository.layer(), source)),
          Layer.provideMerge(Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ),
  )
}

describe('정기 작업 assistant.grant-feed', () => {
  it('매일 4시에 원천 공고를 합치고, 같은 목록이면 다음 날 바꾸는 것이 없습니다', async () => {
    const [runs, grants] = await runFeed(GrantFeedSource.layerMemory([notice('A'), notice('B')]))

    expect(runs.map((run) => [run.slot, run.result])).toEqual([
      ['2026-11-16T04:00', { notices: 2, created: 0, updated: 0 }],
      ['2026-11-15T04:00', { notices: 2, created: 2, updated: 0 }],
    ])
    expect(grants.map((grant) => grant.externalId).toSorted()).toEqual(['A', 'B'])
    // 원천 번호는 응답에 나가지 않습니다.
    expect(Schema.encodeUnknownSync(Grant)(grants[0])).not.toHaveProperty('externalId')
  })

  it('원천을 읽지 못하면 실패로 남겨 다시 시도합니다', async () => {
    const failing = Layer.succeed(
      GrantFeedSource,
      GrantFeedSource.of({ notices: () => Effect.fail(new GrantFeedUnavailable({ source: 'BIZINFO' })) }),
    )
    const [runs, grants] = await runFeed(failing)

    expect(runs[0]).toMatchObject({ status: 'FAILED', lastError: 'GrantFeedUnavailable' })
    expect(grants).toEqual([])
  })
})
