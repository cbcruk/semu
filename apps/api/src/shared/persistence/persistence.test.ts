import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Fiber, Layer, Option } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../ids/ids.types.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { Outbox, relayLoggingDefects } from './outbox.ts'
import { PersistenceMemoryLive, PersistenceSqliteLive } from './persistence.layer.ts'
import { TableFactory, makeSqliteRecordTable, makeTenantTable } from './record-table.ts'
import { SqliteDatabase, UnitOfWork, keepChanges, openSqlite } from './unit-of-work.ts'

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
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.join(' '))),
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
          vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.join(' '))),
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

describe('sqlite seeds', () => {
  afterEach(() => {
    for (const child of running) child.kill()
  })

  const ids = (db: DatabaseSync, table = 'test_seeded') =>
    db
      .prepare(`SELECT id FROM ${table} ORDER BY id`)
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

  it('lets processes that open one new file together seed each table once without failing', async () => {
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

  it('waits for another process seeding the same table and does not seed it again', async () => {
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
