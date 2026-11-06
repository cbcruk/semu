import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { format } from 'node:util'
import { Effect, Fiber, Layer, Option } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { Id } from '../ids/ids.types.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { OUTBOX_MAX_ATTEMPTS, Outbox, relayLoggingDefects } from './outbox.ts'
import { PersistenceMemoryLive, PersistenceSqliteLive } from './persistence.layer.ts'
import { TableFactory, makeSqliteRecordTable, makeTenantTable } from './record-table.ts'
import { CurrentTransaction, SqliteDatabase, UnitOfWork, keepChanges } from './unit-of-work.ts'

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

describe('json codec', () => {
  it('keeps sets, maps, bigints and drops undefined fields', () => {
    const value = { set: new Set([1, 2]), map: new Map([['k', 1]]), big: 10n, gone: undefined, list: [1] }
    expect(decodeRecord(encodeRecord(value))).toEqual({
      set: new Set([1, 2]),
      map: new Map([['k', 1]]),
      big: 10n,
      list: [1],
    })
  })
})

describe('json codec with $-prefixed user keys', () => {
  it('keeps keys that look like tags as plain data', () => {
    const value = {
      keys: { $bigint: 'not-a-number' },
      other: { $set: ['a'], $$x: 1, plain: 2 },
      real: new Set(['z']),
    }
    expect(decodeRecord(encodeRecord(value))).toEqual(value)
  })
})

describe.each(backends)('tenant table (%s)', (_name, layer) => {
  it('scopes reads to the company, keeps id order and round-trips records', () =>
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

describe('sqlite unit of work', () => {
  const layer = PersistenceSqliteLive(':memory:')

  it('rolls back writes when the effect fails or commitIf is false', () =>
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

  it('commits a failing request after keepChanges, but still rolls back defects', () =>
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

  it('delivers outbox events after commit, drops them on rollback and redelivers failures on relay', () =>
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

  it('records only a defect summary in last_error and keeps relaying past a broken row', () =>
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

  it('logs a relay defect as a summary instead of failing', () =>
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

  it('marks an event dead after the attempt limit, stops retrying it, logs it once and keeps delivering others', () =>
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

  it('does not hand over an event that died after the relay read its pending list', () =>
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

  it('does not count a failure on an event that died while the consumer was failing', () => {
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

  it('does not count an attempt when the delivery transaction cannot start', () => {
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
        hooks.push(undefined, () => {
          throw new Error('database is locked')
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
    'adds the missing retry columns to an outbox table %s and keeps its pending events',
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

  it('does not let the relay deliver an event from a transaction that later rolls back, and delivers once', () =>
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

describe('sqlite seeds', () => {
  const ids = (db: DatabaseSync) =>
    db
      .prepare(`SELECT id FROM test_seeded ORDER BY id`)
      .all()
      .map((row) => row['id'])

  it('fails on a duplicate seed ID and leaves the table unseeded and unmarked', () => {
    const db = new DatabaseSync(':memory:')
    const duplicated = [...seed, { ...seed[0]!, amount: 9 }]

    expect(() => makeSqliteRecordTable<Row>(db, 'test_seeded', { seed: duplicated })).toThrow(/UNIQUE/)
    expect(ids(db)).toEqual([])
    expect(db.prepare(`SELECT name FROM semu_meta`).all()).toEqual([])
    expect(db.isTransaction).toBe(false)
  })

  it('lets processes that open one file together seed each table once without failing', async () => {
    const filename = join(mkdtempSync(join(tmpdir(), 'semu-seed-')), 'semu.sqlite')
    const module = new URL('./record-table.ts', import.meta.url).href
    const startAt = Date.now() + 1500
    const script =
      `const { DatabaseSync } = await import('node:sqlite');` +
      `const { makeSqliteRecordTable } = await import(${JSON.stringify(module)});` +
      `const db = new DatabaseSync(${JSON.stringify(filename)});` +
      `db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');` +
      `const seed = Array.from({ length: 500 }, (_, i) => ({ id: 'r' + String(i).padStart(4, '0') }));` +
      `while (Date.now() < ${startAt}) {}` +
      `for (let t = 0; t < 20; t += 1) makeSqliteRecordTable(db, 'race_' + t, { seed });` +
      `db.close()`
    const run = () =>
      new Promise<void>((resolve, reject) =>
        execFile(process.execPath, ['--input-type=module', '-e', script], (error, _stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolve(),
        ),
      )

    await Promise.all(Array.from({ length: 6 }, run))

    const db = new DatabaseSync(filename, { readOnly: true })
    const counts = Array.from({ length: 20 }, (_, t) => db.prepare(`SELECT count(*) AS n FROM race_${t}`).get()?.['n'])
    const markers = db.prepare(`SELECT count(*) AS n FROM semu_meta WHERE name LIKE 'seeded:race_%'`).get()?.['n']
    db.close()
    expect(counts).toEqual(Array(20).fill(500))
    expect(markers).toBe(20)
  }, 30_000)

  it('seeds a table once, so deleted seed rows do not come back on restart', async () => {
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

  it('does not mark a table without a seed, so a seed added later still arrives', () => {
    const db = new DatabaseSync(':memory:')
    makeSqliteRecordTable<Row>(db, 'test_seeded')
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'semu_meta'`).get()).toBeUndefined()

    makeSqliteRecordTable<Row>(db, 'test_seeded', { seed })

    expect(ids(db)).toEqual(['r1', 'r2'])
  })

  it('marks a table that predates the marker without seeding it, and keeps it unseeded after it empties', () => {
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
