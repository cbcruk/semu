import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { format } from 'node:util'
import { Effect, Fiber, Layer, Option } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../ids/ids.types.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { OUTBOX_MAX_ATTEMPTS, Outbox, relayLoggingDefects } from './outbox.ts'
import { PersistenceMemoryLive, PersistenceSqliteLive } from './persistence.layer.ts'
import { TableFactory, makeSqliteRecordTable, makeTenantTable } from './record-table.ts'
import { CurrentTransaction, SqliteDatabase, UnitOfWork, keepChanges, openSqlite } from './unit-of-work.ts'

interface Row {
  id: string
  companyId: Id<'company'>
  tags: Set<string>
  amount: number
  note?: string
}

const A = 'cmp_A' as Id<'company'>
const B = 'cmp_B' as Id<'company'>
const seed: Row[] = [
  { id: 'r2', companyId: A, tags: new Set(['x']), amount: 2 },
  { id: 'r1', companyId: B, tags: new Set(), amount: 1 },
]

const backends = [
  ['memory', PersistenceMemoryLive],
  ['sqlite', PersistenceSqliteLive(':memory:')],
] as const

const run = <A, E>(layer: Layer.Layer<any, any, never>, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.scoped(Effect.provide(effect, layer)) as Effect.Effect<A, E, never>)

/**
 * 트랜잭션을 열 때마다 `hooks`에서 하나를 꺼내 먼저 부르는 SQLite 저장소입니다.
 * 다른 프로세스가 두 트랜잭션 사이에 쓰거나, 트랜잭션을 열지 못하는(busy) 상황을 흉내 냅니다.
 */
function sqliteWithTransactionHooks() {
  const hooks: Array<(() => void) | undefined> = []
  const hookedUnitOfWork = Layer.effect(
    UnitOfWork,
    Effect.gen(function* () {
      const inner = yield* UnitOfWork
      return UnitOfWork.of({
        run: (effect, commitIf) =>
          Effect.suspend(() => {
            hooks.shift()?.()
            return inner.run(effect, commitIf)
          }),
      })
    }),
  ).pipe(Layer.provide(UnitOfWork.layerSqlite))
  const layer = Outbox.layerSqlite.pipe(
    Layer.provideMerge(hookedUnitOfWork),
    Layer.provideMerge(SqliteDatabase.layer(':memory:')),
  )
  return { hooks, layer }
}

describe('JSON 코덱', () => {
  it('Set·Map·bigint는 보존하고 undefined 필드는 버립니다', () => {
    const value = { set: new Set([1, 2]), map: new Map([['k', 1]]), big: 10n, gone: undefined, list: [1] }
    expect(decodeRecord(encodeRecord(value))).toEqual({
      set: new Set([1, 2]),
      map: new Map([['k', 1]]),
      big: 10n,
      list: [1],
    })
  })
})

describe('$로 시작하는 사용자 키와 JSON 코덱', () => {
  it('태그처럼 보이는 키도 일반 데이터로 보존합니다', () => {
    const value = {
      keys: { $bigint: 'not-a-number' },
      other: { $set: ['a'], $$x: 1, plain: 2 },
      real: new Set(['z']),
    }
    expect(decodeRecord(encodeRecord(value))).toEqual(value)
  })
})

describe.each(backends)('회사별 표 (%s)', (_name, layer) => {
  it('회사 범위 안에서만 읽고, 식별자 순서를 지키며, 기록을 저장한 그대로 읽어 옵니다', () =>
    run(
      layer,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<Row>('test_rows', seed)
        yield* table.save({ id: 'r3', companyId: A, tags: new Set(['y']), amount: 3, note: 'n' })

        expect((yield* table.list(A)).map((row) => row.id)).toEqual(['r2', 'r3'])
        expect(yield* table.find(A, 'r3')).toEqual(
          Option.some({ id: 'r3', companyId: A, tags: new Set(['y']), amount: 3, note: 'n' }),
        )
        expect(Option.isNone(yield* table.find(A, 'r1'))).toBe(true)

        yield* table.remove(A, 'r1')
        expect(Option.isSome(yield* table.find(B, 'r1'))).toBe(true)
        yield* table.remove(B, 'r1')
        expect(yield* table.list(B)).toEqual([])
      }),
    ))
})

describe('SQLite 작업 단위', () => {
  const layer = PersistenceSqliteLive(':memory:')

  it('effect가 실패하거나 commitIf가 false이면 쓰기를 롤백합니다', () =>
    run(
      layer,
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const table = yield* (yield* TableFactory).make<{ id: string }>('test_tx')

        yield* Effect.exit(unitOfWork.run(Effect.andThen(table.put({ id: 'failed' }), Effect.fail('boom'))))
        yield* unitOfWork.run(Effect.as(table.put({ id: 'rejected' }), 422), (status) => status < 400)
        yield* unitOfWork.run(table.put({ id: 'kept' }))

        expect((yield* table.all()).map((row) => row.id)).toEqual(['kept'])
      }),
    ))

  it('keepChanges 뒤에는 실패한 요청도 커밋하지만 결함(defect)은 여전히 롤백합니다', () =>
    run(
      layer,
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const table = yield* (yield* TableFactory).make<{ id: string }>('test_keep')

        yield* Effect.exit(
          unitOfWork.run(
            Effect.gen(function* () {
              yield* table.put({ id: 'counter' })
              yield* keepChanges
              return yield* Effect.fail('denied')
            }),
          ),
        )
        yield* unitOfWork.run(
          Effect.as(Effect.andThen(table.put({ id: 'rejected' }), keepChanges), 422),
          (status) => status < 400,
        )
        yield* Effect.exit(
          unitOfWork.run(Effect.andThen(Effect.andThen(table.put({ id: 'defect' }), keepChanges), Effect.die('bug'))),
        )

        expect((yield* table.all()).map((row) => row.id)).toEqual(['counter', 'rejected'])
      }),
    ))

  it('outbox 이벤트를 커밋 뒤에 전달하고, 롤백하면 버리며, 전달에 실패한 이벤트는 릴레이가 다시 전달합니다', () =>
    run(
      layer,
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        const received: string[] = []
        let failNext = true
        const publish = yield* outbox.channel<{ name: string }>('test.event->test', (event) =>
          Effect.suspend(() => {
            if (event.name === 'flaky' && failNext) {
              failNext = false
              return Effect.die('consumer down')
            }
            received.push(event.name)
            return Effect.void
          }),
        )

        yield* unitOfWork.run(
          Effect.gen(function* () {
            yield* publish({ name: 'committed' })
            expect(received).toEqual([])
          }),
        )
        expect(received).toEqual(['committed'])

        yield* Effect.exit(unitOfWork.run(Effect.andThen(publish({ name: 'rolled-back' }), Effect.fail('no'))))
        yield* unitOfWork.run(publish({ name: 'flaky' }))
        expect(received).toEqual(['committed'])

        expect(yield* outbox.relay()).toBe(1)
        expect(received).toEqual(['committed', 'flaky'])
        expect(db.prepare('SELECT count(*) AS n FROM outbox WHERE delivered_at IS NULL').get()).toEqual({ n: 0 })
      }),
    ))

  it('last_error에는 결함 요약만 기록하고 깨진 행을 지나 릴레이를 이어 갑니다', () =>
    run(
      PersistenceSqliteLive(':memory:'),
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        const received: string[] = []
        const publish = yield* outbox.channel<{ name: string }>('leak.event->test', (event) =>
          Effect.suspend(() => {
            if (event.name === 'boom') return Effect.die(new Error('consumer saw owner@semu.example'))
            received.push(event.name)
            return Effect.void
          }),
        )
        yield* unitOfWork.run(publish({ name: 'boom' }))
        db.prepare(
          `INSERT INTO outbox (id, channel, data, created_at) VALUES ('evt_broken', 'leak.event->test', ?, ?)`,
        ).run('{"name":"홍길동","email":"leak@example.com"', new Date().toISOString())
        yield* unitOfWork.run(publish({ name: 'after' }))
        received.length = 0

        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        yield* relayLoggingDefects(outbox)
        for (const spy of spies) spy.mockRestore()

        expect(received).toEqual([])
        const errors = db
          .prepare(`SELECT last_error FROM outbox WHERE last_error IS NOT NULL ORDER BY seq`)
          .all()
          .map((row) => String(row['last_error']))
        expect(errors).toHaveLength(2)
        expect(errors[0]).toMatch(/^Error at src\/shared\/persistence\/persistence\.test\.ts:\d+$/)
        expect(errors[1]).toMatch(/^SyntaxError at src\/shared\/persistence\/json-codec\.ts:\d+$/)
        const leaked = [...errors, ...logs].join('\n')
        for (const value of ['owner@semu.example', 'leak@example.com', '홍길동']) expect(leaked).not.toContain(value)
      }),
    ))

  it('릴레이 결함은 실패시키지 않고 요약으로 로그에 남깁니다', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        yield* relayLoggingDefects(
          Outbox.of({
            channel: () => Effect.die('unused'),
            relay: () => Effect.die(new Error('row for leak@example.com')),
          }),
        )
        for (const spy of spies) spy.mockRestore()

        expect(logs.join('\n')).toContain('Outbox relay defect')
        expect(logs.join('\n')).toContain('Error at src/shared/persistence/persistence.test.ts')
        expect(logs.join('\n')).not.toContain('leak@example.com')
      }),
    ))

  it('시도 한도를 넘긴 이벤트는 dead로 표시해 재시도를 멈추고 로그를 한 번 남기며 다른 이벤트는 계속 전달합니다', () =>
    run(
      PersistenceSqliteLive(':memory:'),
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        const received: string[] = []
        let poisonCalls = 0
        const publish = yield* outbox.channel<{ name: string }>('dead.event->test', (event) =>
          Effect.suspend(() => {
            if (event.name === 'poison') {
              poisonCalls += 1
              return Effect.die(new Error('always fails for owner@semu.example'))
            }
            received.push(event.name)
            return Effect.void
          }),
        )

        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        // 커밋 뒤 전달이 첫 시도입니다.
        yield* unitOfWork.run(publish({ name: 'poison' }))
        yield* unitOfWork.run(publish({ name: 'before' }))
        expect(received).toEqual(['before'])
        for (let relay = 1; relay < OUTBOX_MAX_ATTEMPTS; relay += 1) {
          yield* unitOfWork.run(publish({ name: `ok-${relay}` }))
          yield* outbox.relay()
        }
        expect(poisonCalls).toBe(OUTBOX_MAX_ATTEMPTS)
        expect(received).toEqual(['before', 'ok-1', 'ok-2', 'ok-3', 'ok-4'])

        const dead = db
          .prepare(`SELECT attempts, last_error, dead_at, delivered_at FROM outbox WHERE dead_at IS NOT NULL`)
          .all()
        expect(dead).toHaveLength(1)
        expect(dead[0]!['attempts']).toBe(OUTBOX_MAX_ATTEMPTS)
        expect(String(dead[0]!['last_error'])).toMatch(/^Error at src\/shared\/persistence\/persistence\.test\.ts:\d+$/)
        expect(dead[0]!['delivered_at']).toBeNull()

        expect(yield* outbox.relay()).toBe(0)
        yield* unitOfWork.run(publish({ name: 'after' }))
        expect(yield* outbox.relay()).toBe(0)
        for (const spy of spies) spy.mockRestore()

        expect(poisonCalls).toBe(OUTBOX_MAX_ATTEMPTS)
        expect(received.at(-1)).toBe('after')
        expect(logs.filter((line) => line.includes('Outbox event dead'))).toHaveLength(1)
        expect(logs.join('\n')).not.toContain('owner@semu.example')

        // 운영자가 죽은 이벤트를 다시 살리면 다음 릴레이가 넘깁니다.
        db.exec('UPDATE outbox SET dead_at = NULL, attempts = 0, last_error = NULL WHERE dead_at IS NOT NULL')
        expect(yield* outbox.relay()).toBe(1)
        expect(poisonCalls).toBe(OUTBOX_MAX_ATTEMPTS + 1)
      }),
    ))

  it('릴레이가 대기 목록을 읽은 뒤 dead가 된 이벤트는 넘기지 않습니다', () =>
    run(
      PersistenceSqliteLive(':memory:'),
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        let triggerCalls = 0
        let poisonCalls = 0
        const publish = yield* outbox.channel<{ name: string }>('race-dead.event->test', (event) =>
          Effect.gen(function* () {
            if (event.name === 'poison') {
              poisonCalls += 1
              return yield* Effect.die(new Error('always fails'))
            }
            triggerCalls += 1
            // 커밋 뒤 첫 전달은 실패시켜 밀리게 하고, 릴레이에서 넘겨받으면 커밋 직후 다른 릴레이(다른 프로세스 몫)를 돌립니다.
            if (triggerCalls === 1) return yield* Effect.die(new Error('first try fails'))
            const transaction = yield* CurrentTransaction
            transaction!.afterCommit.push(Effect.asVoid(outbox.relay()))
          }),
        )
        yield* unitOfWork.run(publish({ name: 'trigger' }))
        yield* unitOfWork.run(publish({ name: 'poison' }))
        db.prepare(`UPDATE outbox SET attempts = ? WHERE data LIKE '%poison%'`).run(OUTBOX_MAX_ATTEMPTS - 1)
        poisonCalls = 0

        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        // 이 릴레이는 [trigger, poison]을 읽습니다. trigger를 넘긴 뒤 안쪽 릴레이가 poison의 마지막 시도를 하고 죽입니다.
        yield* outbox.relay()
        for (const spy of spies) spy.mockRestore()

        expect(triggerCalls).toBe(2)
        expect(poisonCalls).toBe(1)
        expect(
          db.prepare(`SELECT attempts, dead_at IS NOT NULL AS dead FROM outbox WHERE data LIKE '%poison%'`).get(),
        ).toEqual({ attempts: OUTBOX_MAX_ATTEMPTS, dead: 1 })
        expect(logs.filter((line) => line.includes('Outbox event dead'))).toHaveLength(1)
      }),
    ))

  it('소비자가 실패하는 사이 dead가 된 이벤트에는 실패 횟수를 더하지 않습니다', () => {
    const { hooks, layer } = sqliteWithTransactionHooks()
    return run(
      layer,
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        const kill = db.prepare(`UPDATE outbox SET attempts = ?, dead_at = ? WHERE data LIKE '%poison%'`)
        let calls = 0
        const publish = yield* outbox.channel<{ name: string }>('dying.event->test', () =>
          Effect.suspend(() => {
            calls += 1
            // 이 실패가 되돌려지고 실패를 남기기 전에, 다른 프로세스의 릴레이가 마지막 시도를 실패시켜 죽인 것으로 둡니다.
            if (calls === 2) hooks.push(() => void kill.run(OUTBOX_MAX_ATTEMPTS, new Date().toISOString()))
            return Effect.die(new Error('always fails'))
          }),
        )
        yield* unitOfWork.run(publish({ name: 'poison' }))
        db.prepare(`UPDATE outbox SET attempts = ? WHERE data LIKE '%poison%'`).run(OUTBOX_MAX_ATTEMPTS - 1)

        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        yield* outbox.relay()
        for (const spy of spies) spy.mockRestore()

        expect(calls).toBe(2)
        expect(hooks).toEqual([])
        expect(db.prepare(`SELECT attempts FROM outbox WHERE data LIKE '%poison%'`).get()).toEqual({
          attempts: OUTBOX_MAX_ATTEMPTS,
        })
        expect(logs.filter((line) => line.includes('Outbox event dead'))).toHaveLength(0)
      }),
    )
  })

  it('전달 트랜잭션을 시작하지 못하면 시도 횟수를 더하지 않습니다', () => {
    const { hooks, layer } = sqliteWithTransactionHooks()
    return run(
      layer,
      Effect.gen(function* () {
        const outbox = yield* Outbox
        const { db } = yield* SqliteDatabase
        let calls = 0
        yield* outbox.channel<{ name: string }>('busy.event->test', () => Effect.sync(() => void (calls += 1)))
        db.prepare(
          `INSERT INTO outbox (id, channel, data, created_at) VALUES ('evt_busy', 'busy.event->test', ?, ?)`,
        ).run(encodeRecord({ name: 'busy' }), new Date().toISOString())

        // 대기 목록을 읽는 트랜잭션은 그대로 열고, 전달 트랜잭션은 다른 프로세스가 잠금을 쥔 것처럼 열지 못하게 합니다.
        // 메시지에 개인정보가 섞인 결함을 흉내 내어, 경고에 메시지 원문이 실리지 않는지 함께 확인합니다.
        hooks.push(undefined, () => {
          throw new Error('database is locked: leaked@example.com')
        })
        const logs: string[] = []
        const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(format(...args))),
        )
        expect(yield* outbox.relay()).toBe(1)
        for (const spy of spies) spy.mockRestore()

        expect(calls).toBe(0)
        expect(db.prepare(`SELECT attempts, last_error, dead_at FROM outbox`).get()).toEqual({
          attempts: 0,
          last_error: null,
          dead_at: null,
        })
        expect(logs.join('\n')).toContain('Outbox delivery not started')
        expect(logs.join('\n')).not.toContain('leaked@example.com')

        expect(yield* outbox.relay()).toBe(1)
        expect(calls).toBe(1)
      }),
    )
  })

  // main의 outbox는 처음부터(08fa0a6) `attempts`·`last_error`가 있었으므로 실제 업그레이드는 `dead_at`만 없는 표입니다.
  // 열이 하나도 없는 표는 배포된 적은 없지만, 마이그레이션이 없는 열만 더하는지 함께 확인합니다.
  const outboxBefore = {
    'without retry columns': {
      columns: '',
      insert: `INSERT INTO outbox (id, channel, data, created_at) VALUES ('evt_old', 'old.event->test', ?, ?)`,
      attemptsBefore: 0,
      lastError: null,
    },
    'from main, without dead_at': {
      columns: `,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT`,
      // 한도를 넘게 실패한 채 남은 행입니다. 업그레이드 뒤 한 번 더 넘겨 봅니다.
      insert: `INSERT INTO outbox (id, channel, data, created_at, attempts, last_error) VALUES ('evt_old', 'old.event->test', ?, ?, 7, 'Error at src/old.ts:1')`,
      attemptsBefore: 7,
      lastError: 'Error at src/old.ts:1',
    },
  } as const

  it.each(Object.entries(outboxBefore))(
    '재시도 열이 빠진 outbox 표(%s)에 열을 더하고 대기 중인 이벤트를 유지합니다',
    (_name, before) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const filename = join(mkdtempSync(join(tmpdir(), 'semu-outbox-')), 'semu.sqlite')
          const old = new DatabaseSync(filename)
          old.exec(
            `CREATE TABLE outbox (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            delivered_at TEXT${before.columns}
          ) STRICT;
          CREATE INDEX outbox_pending ON outbox (delivered_at, seq);`,
          )
          old.prepare(before.insert).run(encodeRecord({ name: 'old' }), new Date().toISOString())
          old.close()

          const received: string[] = []
          const open = Effect.gen(function* () {
            const outbox = yield* Outbox
            yield* outbox.channel<{ name: string }>('old.event->test', (event) =>
              Effect.sync(() => void received.push(event.name)),
            )
            const { db } = yield* SqliteDatabase
            return {
              delivered: yield* outbox.relay(),
              columns: db
                .prepare('PRAGMA table_info(outbox)')
                .all()
                .map((column) => String(column['name'])),
              row: db.prepare(`SELECT attempts, last_error, dead_at FROM outbox WHERE id = 'evt_old'`).get(),
            }
          })

          const first = yield* Effect.scoped(Effect.provide(open, PersistenceSqliteLive(filename)))
          expect(first.columns).toEqual(expect.arrayContaining(['attempts', 'last_error', 'dead_at']))
          expect(first.delivered).toBe(1)
          expect(first.row).toEqual({
            attempts: before.attemptsBefore + 1,
            last_error: before.lastError,
            dead_at: null,
          })
          expect(received).toEqual(['old'])

          // 다시 열어도(열이 이미 있어도) 그대로 열립니다.
          const second = yield* Effect.scoped(Effect.provide(open, PersistenceSqliteLive(filename)))
          expect(second.delivered).toBe(0)
          expect(received).toEqual(['old'])
        }),
      ),
  )

  it('나중에 롤백되는 트랜잭션의 이벤트는 릴레이가 전달하지 않고, 커밋된 이벤트는 한 번만 전달합니다', () =>
    run(
      PersistenceSqliteLive(':memory:'),
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const outbox = yield* Outbox
        const received: string[] = []
        const publish = yield* outbox.channel<{ name: string }>('race.event->test', (event) =>
          Effect.sync(() => {
            received.push(event.name)
          }),
        )

        const request = yield* Effect.forkChild(
          Effect.exit(
            unitOfWork.run(
              Effect.gen(function* () {
                yield* publish({ name: 'rolled-back' })
                yield* Effect.sleep('20 millis')
                return yield* Effect.fail('422')
              }),
            ),
          ),
        )
        yield* Effect.sleep('5 millis')
        yield* outbox.relay()
        yield* Fiber.join(request)
        expect(received).toEqual([])

        yield* unitOfWork.run(publish({ name: 'once' }))
        yield* outbox.relay()
        expect(received).toEqual(['once'])
      }),
    ))
})

/** {@link startChild}로 띄워 아직 끝나지 않은 자식입니다. 테스트가 중간에 실패해도 남지 않게 각 테스트 뒤에 끝냅니다. */
const running = new Set<ChildProcess>()

/**
 * 같은 파일을 여는 다른 프로세스를 띄웁니다. `body`에서는 `openSqlite`, `makeSqliteRecordTable`, `ensureMetaTable`과,
 * 부모가 {@link send}로 보낸 숫자를 한 줄씩 받는 `stdinLine()`을 씁니다. 모듈을 다 읽으면 `ready`를 알립니다.
 */
function startChild(body: string) {
  const module = (name: string) => JSON.stringify(new URL(name, import.meta.url).href)
  const script =
    `const { openSqlite } = await import(${module('./unit-of-work.ts')});` +
    `const { makeSqliteRecordTable } = await import(${module('./record-table.ts')});` +
    `const { ensureMetaTable } = await import(${module('./meta.ts')});` +
    `const lines = (await import('node:readline')).createInterface({ input: process.stdin })[Symbol.asyncIterator]();` +
    `const stdinLine = async () => Number((await lines.next()).value);` +
    `process.stdout.write('ready\\n');` +
    body +
    `;process.stdin.destroy()`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
  running.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exit = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      running.delete(child)
      if (code === 0) resolve()
      else reject(new Error(stderr || `exit ${code}`))
    })
  })
  // 테스트가 먼저 실패해 기다리지 않은 자식이 정리되며 끝나도, 처리되지 않은 거부로 따로 보고되지 않게 합니다.
  exit.catch(() => {})
  // 알림 전에 자식이 죽으면 기다리지 않고 그 오류로 실패합니다.
  const reached = (line: string) =>
    Promise.race([
      exit.then(() => Promise.reject(new Error(`exited before ${line}`))),
      new Promise<void>((resolve) => {
        const check = () => stdout.split('\n').includes(line) && resolve()
        check()
        child.stdout.on('data', check)
      }),
    ])
  return { reached, exit, send: (value: number) => child.stdin.write(`${value}\n`) }
}

describe('SQLite 시드', () => {
  afterEach(() => {
    for (const child of running) child.kill()
  })

  const ids = (db: DatabaseSync, table = 'test_seeded') =>
    db
      .prepare(`SELECT id FROM ${table} ORDER BY id`)
      .all()
      .map((row) => row['id'])

  it('시드 ID가 중복되면 실패하고 표에 시드도 표시도 남기지 않습니다', () => {
    const db = new DatabaseSync(':memory:')
    const duplicated = [...seed, { ...seed[0]!, amount: 9 }]

    expect(() => makeSqliteRecordTable<Row>(db, 'test_seeded', { seed: duplicated })).toThrow(/UNIQUE/)
    expect(ids(db)).toEqual([])
    expect(db.prepare(`SELECT name FROM semu_meta`).all()).toEqual([])
    expect(db.isTransaction).toBe(false)
  })

  it('새 파일 하나를 함께 연 프로세스들이 실패 없이 표마다 시드를 한 번만 넣습니다', async () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'semu-seed-')), 'semu.sqlite')
    const tables = 10
    const rows = 200
    // 모듈을 다 읽은 자식들이 모두 `ready`를 알리면 시작 시각을 보내 한꺼번에 풀어 줍니다. 깨어나는 시각이 자식마다 조금씩 달라,
    // 받은 시각까지 돌며 기다립니다. 풀린 뒤에 파일을 열어 새 파일의 WAL 전환과 시드가 겹치게 합니다.
    const children = Array.from({ length: 6 }, () =>
      startChild(
        `const startAt = await stdinLine(); while (Date.now() < startAt) {}` +
          `const db = openSqlite(${JSON.stringify(filename)});` +
          `const seed = Array.from({ length: ${rows} }, (_, i) => ({ id: 'r' + String(i).padStart(4, '0') }));` +
          `for (let t = 0; t < ${tables}; t += 1) makeSqliteRecordTable(db, 'race_' + t, { seed });` +
          `db.close()`,
      ),
    )

    await Promise.all(children.map((child) => child.reached('ready')))
    const startAt = Date.now() + 100
    for (const child of children) child.send(startAt)
    await Promise.all(children.map((child) => child.exit))

    const db = new DatabaseSync(filename, { readOnly: true })
    const counts = Array.from(
      { length: tables },
      (_, t) => db.prepare(`SELECT count(*) AS n FROM race_${t}`).get()?.['n'],
    )
    const markers = db.prepare(`SELECT count(*) AS n FROM semu_meta WHERE name LIKE 'seeded:race_%'`).get()?.['n']
    const mode = db.prepare(`PRAGMA journal_mode`).get()?.['journal_mode']
    db.close()
    expect(counts).toEqual(Array(tables).fill(rows))
    expect(markers).toBe(tables)
    expect(mode).toBe('wal')
  }, 30_000)

  it('같은 표에 시드를 넣는 다른 프로세스를 기다리고 다시 넣지 않습니다', async () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'semu-seed-')), 'semu.sqlite')
    // 다른 프로세스가 표를 만들어 두고, 시드와 표시를 넣은 트랜잭션을 커밋하지 않은 채 쥐고 있습니다.
    const holder = startChild(
      `const db = openSqlite(${JSON.stringify(filename)});` +
        `makeSqliteRecordTable(db, 'race');` +
        `ensureMetaTable(db);` +
        `db.exec('BEGIN IMMEDIATE');` +
        `makeSqliteRecordTable(db, 'race', { seed: [{ id: 'theirs' }] });` +
        `process.stdout.write('locked\\n');` +
        `const releaseAt = await stdinLine(); while (Date.now() < releaseAt) {}` +
        `db.exec('COMMIT'); db.close()`,
    )
    await holder.reached('locked')

    // 그동안 이쪽이 같은 표에 시드를 넣으려 합니다. 표시를 확인하기 전에 쓰기 잠금부터 기다려야, 커밋된 표시를 보고 넘어갑니다.
    // 이 호출은 동기라 기다리는 동안 이벤트 루프가 멈추므로, 자식이 커밋할 시각을 미리 정해 보냅니다. 그 전에 이쪽이 시작해야
    // 경합이 생기고, 이쪽이 그보다 늦으면 경합 없이 통과할 뿐 실패하지는 않습니다.
    holder.send(Date.now() + 300)
    const db = openSqlite(filename)
    try {
      makeSqliteRecordTable<Row>(db, 'race', { seed })
      expect(ids(db, 'race')).toEqual(['theirs'])
    } finally {
      db.close()
    }
    await holder.exit
  }, 30_000)

  it('표마다 시드를 한 번만 넣어 지운 시드 행이 재시작 뒤 되살아나지 않습니다', async () => {
    const db = new DatabaseSync(':memory:')
    const table = makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })
    expect(ids(db)).toEqual(['r1', 'r2'])

    await Effect.runPromise(Effect.all([table.remove('r1'), table.remove('r2')]))
    makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })

    expect(ids(db)).toEqual([])
    expect(
      db
        .prepare(`SELECT name FROM semu_meta`)
        .all()
        .map((row) => row['name']),
    ).toEqual(['seeded:test_seeded'])
  })

  it('시드가 없는 표는 표시하지 않아 나중에 더한 시드가 들어옵니다', () => {
    const db = new DatabaseSync(':memory:')
    makeSqliteRecordTable<Row>(db, 'test_seeded')
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'semu_meta'`).get()).toBeUndefined()

    makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })

    expect(ids(db)).toEqual(['r1', 'r2'])
  })

  it('표시가 생기기 전부터 있던 표는 시드 없이 표시만 하고, 비워진 뒤에도 시드를 넣지 않습니다', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE test_seeded (id TEXT PRIMARY KEY, company_id TEXT, data TEXT NOT NULL) STRICT`)
    db.prepare(`INSERT INTO test_seeded (id, company_id, data) VALUES ('r9', NULL, ?)`).run(encodeRecord({ id: 'r9' }))

    makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })
    expect(ids(db)).toEqual(['r9'])
    db.exec(`DELETE FROM test_seeded`)
    makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })

    expect(ids(db)).toEqual([])
  })
})
