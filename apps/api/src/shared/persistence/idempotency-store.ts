import { Effect, Option, Semaphore } from 'effect'
import type { Id } from '../ids/ids.types.ts'
import { TableFactory } from './record-table.ts'

/**
 * `Idempotency-Key` 하나로 받은 요청의 기록입니다. ID는 {@link idempotencyRecordId}(회사·행위자·키)입니다.
 *
 * - `IN_PROGRESS`: 처리 중입니다. 같은 키의 다른 요청은 409입니다
 * - `UNCERTAIN`: 외부 기관에 요청을 보냈지만 결과를 확인하지 못했습니다(결함·시간 초과). 같은 키·같은 본문으로 다시 오면
 *   같은 `reference`로 외부 기관에 다시 물어 이어 갑니다
 * - `COMPLETED`: 끝났습니다. 같은 키·같은 본문이면 `response`를 그대로 돌려줍니다
 *
 * 실패로 끝난 요청(외부 기관의 거절 포함)은 기록을 남기지 않습니다. `COMPLETED`는 끝난 시각(`finishedAt`)부터 24시간이 지나면 없는 것으로
 * 보고, `UNCERTAIN`은 결과를 받아 끝낼 때까지 만료하지 않습니다.
 */
export interface IdempotencyRecord {
  id: string
  companyId: Id<'company'>
  actorUserId: Id<'user'>
  key: string
  /** 엔드포인트 이름과 요청 내용의 지문(`requestFingerprint`)입니다. */
  fingerprint: string
  status: 'IN_PROGRESS' | 'UNCERTAIN' | 'COMPLETED'
  /** 외부 기관에 넘기는 멱등 참조입니다. 결과를 모르는 시도를 이어 갈 때 같은 값을 다시 넘깁니다. */
  reference: string
  /** `COMPLETED`일 때 처음 응답 본문(JSON)입니다. 아니면 `null`입니다. */
  response: unknown
  createdAt: string
  finishedAt: string | null
}

/** 요청 기록의 ID입니다. 키는 회사와 행위자마다 따로입니다. */
export function idempotencyRecordId(companyId: Id<'company'>, actorUserId: Id<'user'>, key: string): string {
  return `${companyId}:${actorUserId}:${key}`
}

/** `Idempotency-Key` 요청 기록 저장소입니다. 컨텍스트마다 자기 표로 하나씩 만듭니다({@link makeIdempotencyStore}). */
export interface IdempotencyStore {
  /**
   * 기록 `id`를 읽고 `decide`가 돌려준 기록으로 바꿉니다(`null`이면 그대로 둡니다). 읽기와 쓰기 사이에 같은 저장소의 다른
   * `claim`·`save`·`remove`가 끼어들지 않으므로, 키 확인과 예약이 한 번에 일어납니다.
   */
  claim<A>(
    id: string,
    decide: (existing: Option.Option<IdempotencyRecord>) => readonly [A, IdempotencyRecord | null],
  ): Effect.Effect<A>
  save(record: IdempotencyRecord): Effect.Effect<void>
  remove(id: string): Effect.Effect<void>
}

/**
 * `table` 표에 요청 기록을 둡니다. 표 이름은 `<context>_idempotency_keys`입니다.
 *
 * 잠금은 명세서 발송 기록(`PayslipRepository.claimSend`)과 같은 방어용입니다. 지금 메모리 표의 읽기·쓰기는 동기이고 SQLite는
 * 요청 트랜잭션이 쓰기 잠금을 쥐고 있어, 이 잠금이 없어도 확인과 예약 사이에 다른 요청이 끼어들지 않습니다.
 */
export function makeIdempotencyStore(table: string): Effect.Effect<IdempotencyStore, never, TableFactory> {
  return Effect.gen(function* () {
    const records = yield* (yield* TableFactory).make<IdempotencyRecord>(table, {
      companyOf: (record) => record.companyId,
    })
    const lock = yield* Semaphore.make(1)
    return {
      claim: (id, decide) =>
        lock.withPermit(
          Effect.gen(function* () {
            const [result, next] = decide(yield* records.get(id))
            if (next !== null) yield* records.put(next)
            return result
          }),
        ),
      save: (record) => lock.withPermit(records.put(record)),
      remove: (id) => lock.withPermit(records.remove(id)),
    }
  })
}
