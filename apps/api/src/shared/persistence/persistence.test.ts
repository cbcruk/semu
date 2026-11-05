import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../ids/ids.types.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { Outbox } from './outbox.ts'
import { PersistenceMemoryLive, PersistenceSqliteLive } from './persistence.layer.ts'
import { TableFactory, makeTenantTable } from './record-table.ts'
import { SqliteDatabase, UnitOfWork, keepOnRollback } from './unit-of-work.ts'

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

  it('keeps writes marked keepOnRollback when the rest of the transaction rolls back', () =>
    run(
      layer,
      Effect.gen(function* () {
        const unitOfWork = yield* UnitOfWork
        const table = yield* (yield* TableFactory).make<{ id: string }>('test_keep')

        yield* Effect.exit(
          unitOfWork.run(
            Effect.gen(function* () {
              yield* table.put({ id: 'dropped' })
              yield* keepOnRollback(table.put({ id: 'counter' }))
              return yield* Effect.fail('denied')
            }),
          ),
        )

        expect((yield* table.all()).map((row) => row.id)).toEqual(['counter'])
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
})
