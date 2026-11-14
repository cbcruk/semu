import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'
import { TableFactory, makeMemoryRecordTable } from '../persistence/record-table.ts'
import { SqliteDatabase, UnitOfWork } from '../persistence/unit-of-work.ts'
import { CompaniesFailed, Scheduler, eachCompany } from './scheduler.ts'
import type { SlotOutcome } from './scheduler.ts'
import type { ScheduledTask } from './scheduler.ts'

const kst = (local: string) => Date.parse(`${local}+09:00`)

/** 메모리 표와 트랜잭션 없는 작업 단위입니다. */
const memory = Layer.merge(TableFactory.layerMemory, UnitOfWork.layerNone)

function run<A>(
  tasks: ReadonlyArray<ScheduledTask<UnitOfWork>>,
  body: (scheduler: Scheduler['Service']) => Effect.Effect<A>,
  stores: Layer.Layer<TableFactory | UnitOfWork> = memory,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* body(yield* Scheduler)
    }).pipe(Effect.provide(Scheduler.layer(tasks).pipe(Layer.provideMerge(stores))), Effect.provide(TestClock.layer())),
  )
}

describe('Scheduler', () => {
  it('슬롯마다 한 번만 돌고 다음 슬롯이 오면 다시 돕니다', async () => {
    const calls: string[] = []
    const task: ScheduledTask<UnitOfWork> = {
      name: 'test.daily',
      spec: { kind: 'DAILY', at: '03:00' },
      run: (slot) => Effect.sync(() => calls.push(slot.key)),
    }

    const outcomes = await run([task], (scheduler) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
        const first = yield* scheduler.runDue()
        yield* TestClock.setTime(kst('2026-11-14T23:00:00'))
        const again = yield* scheduler.runDue()
        yield* TestClock.setTime(kst('2026-11-15T03:01:00'))
        const next = yield* scheduler.runDue()
        return [first, again, next].map((result) => result[0]!.outcome)
      }),
    )

    expect(outcomes).toEqual(['SUCCEEDED', 'SKIPPED', 'SUCCEEDED'])
    expect(calls).toEqual(['2026-11-14T03:00', '2026-11-15T03:00'])
  })

  it('실패한 슬롯은 지연 뒤 다시 시도하고 결과와 오류 요약을 기록합니다', async () => {
    let attempts = 0
    const task: ScheduledTask<UnitOfWork> = {
      name: 'test.flaky',
      spec: { kind: 'DAILY', at: '03:00' },
      retry: { maxAttempts: 3, baseDelayMs: 60_000, leaseMs: 600_000 },
      run: () =>
        Effect.suspend(() => {
          attempts += 1
          return attempts === 1 ? Effect.fail(new CompaniesFailed({ succeeded: 0, failed: [] })) : Effect.succeed('ok')
        }),
    }

    const [outcomes, runs] = await run([task], (scheduler) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
        const first = yield* scheduler.runDue()
        const waiting = yield* scheduler.runDue()
        yield* TestClock.adjust('1 minute')
        const retried = yield* scheduler.runDue()
        return [[first, waiting, retried].map((result) => result[0]!.outcome), yield* scheduler.runs()] as const
      }),
    )

    expect(outcomes).toEqual(['FAILED', 'SKIPPED', 'SUCCEEDED'])
    expect(runs).toMatchObject([
      {
        id: 'test.flaky@2026-11-14T03:00',
        status: 'SUCCEEDED',
        attempts: 2,
        result: 'ok',
        lastError: 'CompaniesFailed',
      },
    ])
  })

  it('결함도 실패로 남기고 다른 작업은 계속 돕니다', async () => {
    const broken: ScheduledTask<UnitOfWork> = {
      name: 'test.broken',
      spec: { kind: 'DAILY', at: '03:00' },
      run: () => Effect.die(new TypeError('boom')),
    }
    const fine: ScheduledTask<UnitOfWork> = { name: 'test.fine', spec: broken.spec, run: () => Effect.void }

    const [outcomes, runs] = await run([broken, fine], (scheduler) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
        return [yield* scheduler.runDue(), yield* scheduler.runs()] as const
      }),
    )

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['FAILED', 'SUCCEEDED'])
    const failure = runs.find((record) => record.task === 'test.broken')!
    expect(failure.lastError).toMatch(/^TypeError at src\/shared\/scheduler\/scheduler\.test\.ts:\d+$/)
  })

  it('한 작업의 실행 기록 저장에서 결함이 나도 다음 작업은 돕니다', async () => {
    const calls: string[] = []
    const first: ScheduledTask<UnitOfWork> = {
      name: 'test.first',
      spec: { kind: 'DAILY', at: '03:00' },
      run: () => Effect.sync(() => calls.push('first')),
    }
    const second: ScheduledTask<UnitOfWork> = {
      ...first,
      name: 'test.second',
      run: () => Effect.sync(() => calls.push('second')),
    }
    // 첫 작업의 기록을 쓸 때만 결함을 내는 표입니다.
    const brokenTables = Layer.succeed(
      TableFactory,
      TableFactory.of({
        make: <T extends { readonly id: string }>() =>
          Effect.gen(function* () {
            const inner = yield* makeMemoryRecordTable<T>()
            return {
              ...inner,
              put: (record: T) =>
                record.id.startsWith('test.first@') ? Effect.die(new Error('disk')) : inner.put(record),
            }
          }),
      }),
    )

    const outcomes = await run(
      [first, second],
      (scheduler) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
          return yield* scheduler.runDue()
        }),
      Layer.merge(brokenTables, UnitOfWork.layerNone),
    )

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(['ERRORED', 'SUCCEEDED'])
    expect(calls).toEqual(['second'])
  })

  it('같은 데이터베이스를 쓰는 실행기 둘 중 한쪽만 슬롯을 돌립니다', async () => {
    let calls = 0
    const task: ScheduledTask<UnitOfWork> = {
      name: 'test.once',
      spec: { kind: 'DAILY', at: '03:00' },
      run: () => Effect.sync(() => (calls += 1)),
    }
    const sqlite = Layer.merge(TableFactory.layerSqlite, UnitOfWork.layerSqlite).pipe(
      Layer.provide(SqliteDatabase.layer(':memory:')),
    )

    const outcomes = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
          // 레이어를 직접 두 번 지어 실행기 둘(프로세스 둘에 해당)을 만듭니다. 표와 트랜잭션은 같은 데이터베이스입니다.
          const first = Context.get(yield* Layer.build(Scheduler.layer([task])), Scheduler)
          const second = Context.get(yield* Layer.build(Scheduler.layer([task])), Scheduler)
          return yield* Effect.all([first.runDue(), second.runDue()], { concurrency: 2 })
        }),
      ).pipe(Effect.provide(sqlite), Effect.provide(TestClock.layer())),
    )

    expect(outcomes.map((result) => result[0]!.outcome).toSorted()).toEqual(['SKIPPED', 'SUCCEEDED'])
    expect(calls).toBe(1)
  })
})

/** 같은 이름의 표를 한 번만 만들어 함께 쓰는 메모리 저장소입니다. 실행기 둘이 같은 데이터베이스를 쓰는 것에 해당합니다. */
const sharedMemory = Layer.merge(
  Layer.effect(
    TableFactory,
    Effect.sync(() => {
      const tables = new Map<string, unknown>()
      return TableFactory.of({
        make: <T extends { readonly id: string }>(name: string) =>
          Effect.gen(function* () {
            if (!tables.has(name)) tables.set(name, yield* makeMemoryRecordTable<T>())
            return tables.get(name) as Effect.Success<ReturnType<typeof makeMemoryRecordTable<T>>>
          }),
      })
    }),
  ),
  UnitOfWork.layerNone,
)

/**
 * 실행기 둘을 같은 저장소로 짓고, 첫 실행기가 회사마다 `minutesPerCompany`분씩 걸리며 세 회사를 도는 동안 첫 회사가 끝날 때 둘째
 * 실행기가 같은 슬롯을 넘봅니다. 두 실행기의 결과와 첫 실행기가 끝낸 회사, 실행 기록을 돌려줍니다.
 */
function overlapping(minutesPerCompany: number) {
  const done: string[] = []
  let second: Scheduler['Service'] | undefined
  let secondOutcome: SlotOutcome | undefined
  let runs = 0
  const task: ScheduledTask<UnitOfWork> = {
    name: 'test.companies',
    spec: { kind: 'DAILY', at: '03:00' },
    retry: { maxAttempts: 3, baseDelayMs: 60_000, leaseMs: 10 * 60_000 },
    run: () => {
      const runner = ++runs
      return eachCompany(
        ['com_a', 'com_b', 'com_c'],
        (id) => id,
        (id) =>
          Effect.gen(function* () {
            yield* TestClock.adjust(`${minutesPerCompany} minutes`)
            done.push(`${runner}:${id}`)
            if (runner === 1 && id === 'com_a') secondOutcome = (yield* second!.runDue())[0]
          }),
      )
    },
  }
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(kst('2026-11-14T03:00:00'))
        const first = Context.get(yield* Layer.build(Scheduler.layer([task])), Scheduler)
        second = Context.get(yield* Layer.build(Scheduler.layer([task])), Scheduler)
        const firstOutcome = (yield* first.runDue())[0]!
        return { firstOutcome, secondOutcome, done, runs: yield* first.runs() }
      }),
    ).pipe(Effect.provide(sharedMemory), Effect.provide(TestClock.layer())),
  )
}

describe('임대 갱신', () => {
  it('회사마다 임대를 늘려 임대 시간보다 오래 돌아도 다른 실행기가 잡지 않습니다', async () => {
    const result = await overlapping(8)

    expect(result.secondOutcome?.outcome).toBe('SKIPPED')
    expect(result.firstOutcome.outcome).toBe('SUCCEEDED')
    expect(result.done).toEqual(['1:com_a', '1:com_b', '1:com_c'])
    expect(result.runs).toMatchObject([{ status: 'SUCCEEDED', attempts: 1 }])
  })

  it('회사 하나가 임대 시간을 넘겨 다른 실행기가 잡으면 남은 회사로 넘어가지 않고 기록을 덮어쓰지 않습니다', async () => {
    const result = await overlapping(11)

    expect(result.secondOutcome?.outcome).toBe('SUCCEEDED')
    expect(result.firstOutcome.outcome).toBe('LEASE_LOST')
    expect(result.done).toEqual(['1:com_a', '2:com_a', '2:com_b', '2:com_c'])
    expect(result.runs).toMatchObject([{ status: 'SUCCEEDED', attempts: 2 }])
  })
})

describe('eachCompany', () => {
  it('회사마다 따로 돌려 한 회사가 실패해도 나머지를 끝내고 실패한 회사를 모아 실패합니다', async () => {
    const done: string[] = []
    const exit = await Effect.runPromise(
      Effect.exit(
        eachCompany(
          ['com_a', 'com_b', 'com_c'],
          (id) => id,
          (id) => (id === 'com_b' ? Effect.fail({ _tag: 'Boom' as const }) : Effect.sync(() => done.push(id))),
        ),
      ).pipe(Effect.provide(UnitOfWork.layerNone)),
    )

    expect(done).toEqual(['com_a', 'com_c'])
    expect(exit._tag).toBe('Failure')
    if (exit._tag !== 'Failure') return
    expect(JSON.stringify(exit.cause)).toContain('com_b')
  })
})
