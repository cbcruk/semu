import { DatabaseSync } from 'node:sqlite'
import { Cause, Context, Effect, Exit, Layer, Semaphore } from 'effect'

/** 진행 중인 트랜잭션입니다. 커밋된 뒤에 실행할 작업(outbox 전달)을 모읍니다. */
export interface Transaction {
  readonly afterCommit: Array<Effect.Effect<void>>
  /** 참이면 오류 응답(4xx)이나 도메인 실패로 끝나도 커밋합니다. {@link keepChanges}가 켭니다. 결함이면 그래도 되돌립니다. */
  keep: boolean
}

/** 지금 파이버가 속한 트랜잭션입니다. 트랜잭션 밖이면 `null`입니다. */
export const CurrentTransaction = Context.Reference<Transaction | null>('semu/persistence/CurrentTransaction', {
  defaultValue: () => null,
})

/**
 * 지금 트랜잭션에 쓴 내용을 요청이 실패(4xx·도메인 오류)로 끝나도 남깁니다. 트랜잭션 밖이거나 메모리 저장소면 아무것도 하지 않습니다.
 *
 * 실패 응답과 함께 남아야 하는 기록에 씁니다. 예: 로그인 실패 횟수, 재사용된 리프레시 토큰의 세션 폐기, 은행이 거절한 출금 계좌, 감사 기록.
 * 이 호출 전후에 쓴 내용이 모두 남으므로, 실패를 판정한 뒤 남길 기록만 쓰고 바로 실패를 돌려줍니다.
 */
export const keepChanges: Effect.Effect<void> = Effect.gen(function* () {
  const transaction = yield* CurrentTransaction
  if (transaction !== null) transaction.keep = true
})

/** SQLite 연결입니다. 프로세스에 하나만 둡니다. */
export class SqliteDatabase extends Context.Service<SqliteDatabase, { readonly db: DatabaseSync }>()(
  'semu/persistence/SqliteDatabase',
) {
  /**
   * `filename`의 DB를 엽니다. `:memory:`면 프로세스 메모리 DB입니다. 레이어가 닫힐 때 연결을 닫습니다.
   *
   * WAL로 열어 읽기가 쓰기를 막지 않게 하고, 쓰기 잠금을 기다리는 시간을 5초로 둡니다.
   */
  static readonly layer = (filename: string) =>
    Layer.effect(
      SqliteDatabase,
      Effect.acquireRelease(
        Effect.sync(() => {
          const db = new DatabaseSync(filename)
          db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
          return SqliteDatabase.of({ db })
        }),
        ({ db }) => Effect.sync(() => db.close()),
      ),
    )
}

/**
 * 요청 하나를 한 트랜잭션으로 묶습니다. HTTP 미들웨어({@link import('./unit-of-work-middleware.ts')})가 요청마다 씁니다.
 *
 * - `commitIf`가 거짓이거나 실패·결함이면 되돌립니다. 단 {@link keepChanges}를 불렀으면 결함이 아닌 한 커밋합니다
 * - 이미 트랜잭션 안이면 새로 열지 않고 그 안에서 실행합니다
 * - 커밋한 뒤 `afterCommit` 작업을 트랜잭션 밖에서 차례로 실행합니다
 */
export class UnitOfWork extends Context.Service<
  UnitOfWork,
  {
    run<A, E, R>(effect: Effect.Effect<A, E, R>, commitIf?: (value: A) => boolean): Effect.Effect<A, E, R>
  }
>()('semu/persistence/UnitOfWork') {
  /** 트랜잭션이 없는 저장소(메모리)용입니다. 그대로 실행하고, 커밋 뒤 작업도 없습니다. */
  static readonly layerNone = Layer.succeed(UnitOfWork, UnitOfWork.of({ run: (effect) => effect }))

  /**
   * SQLite 트랜잭션입니다. 연결이 하나라 트랜잭션은 한 번에 하나씩 엽니다(세마포어). 커밋 뒤 작업은 세마포어를 놓은 뒤 실행합니다.
   */
  static readonly layerSqlite: Layer.Layer<UnitOfWork, never, SqliteDatabase> = Layer.effect(
    UnitOfWork,
    Effect.gen(function* () {
      const { db } = yield* SqliteDatabase
      const lock = yield* Semaphore.make(1)

      const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>, commitIf: (value: A) => boolean) =>
        lock.withPermit(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const transaction: Transaction = { afterCommit: [], keep: false }
              db.exec('BEGIN IMMEDIATE')
              const exit = yield* Effect.exit(restore(Effect.provideService(effect, CurrentTransaction, transaction)))
              const commit = Exit.isSuccess(exit)
                ? commitIf(exit.value) || transaction.keep
                : transaction.keep && !Cause.hasDies(exit.cause)
              db.exec(commit ? 'COMMIT' : 'ROLLBACK')
              return { exit, afterCommit: commit ? transaction.afterCommit : [] }
            }),
          ),
        )

      return UnitOfWork.of({
        run: (effect, commitIf = () => true) =>
          Effect.gen(function* () {
            if ((yield* CurrentTransaction) !== null) return yield* effect
            const { exit, afterCommit } = yield* inTransaction(effect, commitIf)
            for (const task of afterCommit) yield* task
            return yield* exit
          }),
      })
    }),
  )
}
