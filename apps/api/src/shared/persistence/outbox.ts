import { Context, Effect, Layer, Schedule } from 'effect'
import { newId } from '../ids/ids.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { CurrentTransaction, SqliteDatabase, UnitOfWork } from './unit-of-work.ts'

/**
 * 컨텍스트 사이 이벤트를 소비자에게 넘기는 통로입니다 ([events.md](../../../../../docs/design/events.md)).
 *
 * `channel(name, handler)`로 소비자를 등록하고, 돌려받은 함수로 이벤트를 냅니다. 채널 이름은 `<event type>-><consumer>`처럼
 * 소비자마다 달라야 합니다. 소비 처리는 멱등이어야 합니다(최소 1회 전달).
 */
export class Outbox extends Context.Service<
  Outbox,
  {
    channel<A>(
      name: string,
      handler: (event: A) => Effect.Effect<void>,
    ): Effect.Effect<(event: A) => Effect.Effect<void>>
    /** 아직 전달하지 못한 이벤트를 다시 넘깁니다. 넘긴 건수를 돌려줍니다. */
    relay(): Effect.Effect<number>
  }
>()('semu/persistence/Outbox') {
  /** 저장 없이 바로 소비자를 부릅니다. 메모리 저장소와 함께 씁니다. */
  static readonly layerDirect = Layer.succeed(
    Outbox,
    Outbox.of({ channel: (_name, handler) => Effect.succeed(handler), relay: () => Effect.succeed(0) }),
  )

  /**
   * 이벤트를 상태 변경과 같은 트랜잭션에서 `outbox` 표에 쓰고, 커밋된 뒤 소비자에게 넘깁니다. 되돌리면 이벤트도 사라집니다.
   *
   * 소비자 처리는 자기 트랜잭션에서 합니다. 실패(결함)하면 `attempts`·`last_error`를 남기고 다음 `relay`에서 다시 넘깁니다.
   */
  static readonly layerSqlite: Layer.Layer<Outbox, never, SqliteDatabase | UnitOfWork> = Layer.effect(
    Outbox,
    Effect.gen(function* () {
      const { db } = yield* SqliteDatabase
      const unitOfWork = yield* UnitOfWork
      db.exec(
        `CREATE TABLE IF NOT EXISTS outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          channel TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL,
          delivered_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        ) STRICT;
        CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (delivered_at, seq);`,
      )
      const insert = db.prepare('INSERT INTO outbox (id, channel, data, created_at) VALUES (?, ?, ?, ?)')
      const markDelivered = db.prepare('UPDATE outbox SET delivered_at = ?, attempts = attempts + 1 WHERE seq = ?')
      const markFailed = db.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE seq = ?')
      const pending = db.prepare('SELECT seq, channel, data FROM outbox WHERE delivered_at IS NULL ORDER BY seq')
      const handlers = new Map<string, (event: unknown) => Effect.Effect<void>>()

      const deliver = (seq: number, channel: string, event: unknown): Effect.Effect<void> => {
        const handler = handlers.get(channel)
        if (handler === undefined) return Effect.void
        return unitOfWork.run(handler(event)).pipe(
          Effect.andThen(Effect.sync(() => markDelivered.run(new Date().toISOString(), seq))),
          Effect.catchDefect((defect) => Effect.sync(() => markFailed.run(String(defect), seq))),
          Effect.asVoid,
        )
      }

      return Outbox.of({
        channel: <A>(name: string, handler: (event: A) => Effect.Effect<void>) =>
          Effect.sync(() => {
            if (handlers.has(name)) throw new Error(`Outbox channel registered twice: ${name}`)
            handlers.set(name, handler as (event: unknown) => Effect.Effect<void>)
            return (event: A) =>
              Effect.gen(function* () {
                const result = insert.run(newId('event'), name, encodeRecord(event), new Date().toISOString())
                const seq = Number(result.lastInsertRowid)
                const delivery = Effect.suspend(() => deliver(seq, name, decodeRecord(encodeRecord(event))))
                const transaction = yield* CurrentTransaction
                if (transaction === null) yield* delivery
                else transaction.afterCommit.push(delivery)
              })
          }),
        relay: () =>
          Effect.gen(function* () {
            const rows = pending.all()
            for (const row of rows) {
              yield* deliver(Number(row['seq']), row['channel'] as string, decodeRecord(row['data'] as string))
            }
            return rows.length
          }),
      })
    }),
  )
}

/**
 * 시작할 때와 그 뒤 주기적으로 밀린 이벤트를 다시 넘깁니다. 채널이 모두 등록된 뒤(어댑터 위)에 얹습니다.
 */
export const OutboxRelayLive = (interval: `${number} seconds` = '30 seconds'): Layer.Layer<never, never, Outbox> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const outbox = yield* Outbox
      yield* outbox.relay()
      yield* Effect.forkScoped(Effect.repeat(outbox.relay(), Schedule.spaced(interval)))
    }),
  )
