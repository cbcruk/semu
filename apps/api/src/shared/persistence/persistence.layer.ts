import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/http'
import { Outbox, OutboxRelayLive } from './outbox.ts'
import { TableFactory } from './record-table.ts'
import { SqliteDatabase, UnitOfWork } from './unit-of-work.ts'

/**
 * 요청마다 한 트랜잭션을 엽니다. 응답이 4xx·5xx이거나 결함이면 되돌리고, 그 밖에는 커밋합니다.
 *
 * 저장소가 메모리면 `UnitOfWork.layerNone`이라 아무것도 하지 않습니다.
 */
export const UnitOfWorkMiddleware = HttpRouter.middleware(
  Effect.gen(function* () {
    const unitOfWork = yield* UnitOfWork
    return (httpEffect) => unitOfWork.run(httpEffect, (response) => response.status < 400)
  }),
  { global: true },
)

/** 메모리 저장소입니다. 트랜잭션이 없고 이벤트는 바로 소비자에게 갑니다. */
export const PersistenceMemoryLive = Layer.mergeAll(TableFactory.layerMemory, UnitOfWork.layerNone, Outbox.layerDirect)

/**
 * `filename`의 SQLite 저장소입니다. 표·트랜잭션·outbox가 같은 연결을 씁니다.
 *
 * 밀린 이벤트 재전달({@link OutboxRelayLive})은 어댑터가 채널을 등록한 뒤에 얹어야 하므로 여기 넣지 않습니다.
 */
export const PersistenceSqliteLive = (filename: string) =>
  Layer.mergeAll(TableFactory.layerSqlite, Outbox.layerSqlite).pipe(
    Layer.provideMerge(UnitOfWork.layerSqlite),
    Layer.provideMerge(SqliteDatabase.layer(filename)),
  )

export { OutboxRelayLive }
