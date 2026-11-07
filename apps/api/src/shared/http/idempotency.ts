import { createHash, randomUUID } from 'node:crypto'
import { Cause, Clock, Effect, Exit, Option } from 'effect'
import type { Id } from '../ids/ids.types.ts'
import { idempotencyRecordId, type IdempotencyRecord, type IdempotencyStore } from '../persistence/idempotency-store.ts'
import { keepChanges } from '../persistence/unit-of-work.ts'
import {
  ExternalOutcomeUnknown,
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
} from '../problem/problem.ts'

/** `Idempotency-Key`를 기억하는 시간입니다. 지나면 같은 키도 새 요청으로 처리합니다(conventions.md 멱등성). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** 기억한 키가 `now`에 만료됐는지 봅니다. `createdAt`은 키를 처음 받은 시각(ISO)입니다. */
export function idempotencyExpired(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) >= IDEMPOTENCY_TTL_MS
}

/**
 * 요청 본문의 지문입니다. 객체 키를 정렬한 JSON의 SHA-256(hex)이라 키 순서·공백이 달라도 같은 본문이면 같습니다.
 * 배열 순서는 응답 순서를 정하므로 그대로 둡니다.
 */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** {@link runIdempotent}이 받는 요청입니다. */
export interface IdempotentRequest {
  /** 컨텍스트의 요청 기록 저장소입니다. */
  readonly store: IdempotencyStore
  readonly companyId: Id<'company'>
  readonly actorUserId: Id<'user'>
  /** `Idempotency-Key` 헤더 값입니다. 없거나 비면 428입니다. */
  readonly key: string | undefined
  /** 엔드포인트 이름입니다. 지문에 들어가므로 같은 키를 다른 엔드포인트에 쓰면 422입니다. */
  readonly operation: string
  /**
   * 지문을 만들 요청 내용(경로의 리소스 ID와 본문)입니다. 지문은 저장되고 짧은 값의 SHA-256은 거꾸로 찾을 수 있으므로, 계좌번호
   * 전체·비밀번호·생년월일 같은 비밀 값은 넣지 않고 끝 4자리 같은 가린 값을 넣습니다.
   */
  readonly request: unknown
}

/** 예약한 시도 하나입니다. */
export interface IdempotentAttempt {
  /**
   * 외부 기관에 넘길 멱등 참조입니다. 시도마다 새로 만들고, 결과를 모르는 채 끝난 시도(`UNCERTAIN`)를 같은 키로 이어 갈 때만 같은 값을
   * 다시 줍니다. 외부 기관은 같은 참조의 재요청에 다시 처리하지 않고 처음 결과를 돌려줘야 합니다.
   */
  readonly reference: string
  /** 결과를 모르는 앞 시도를 이어 가는 중이면 참입니다. 앞 시도가 남긴 기록(발급 중인 세금계산서 등)을 다시 만들지 않고 찾아 씁니다. */
  readonly resumed: boolean
}

type Claim<A> =
  | { _tag: 'Start'; record: IdempotencyRecord; resumed: boolean }
  | { _tag: 'Replay'; response: A }
  | { _tag: 'Reused' }
  | { _tag: 'InProgress' }

/**
 * `run`을 `Idempotency-Key` 규칙(conventions.md 멱등성)으로 감쌉니다. 키는 회사·행위자마다 따로이고 24시간 동안 기억합니다.
 *
 * 1. 키가 없으면 428 `IDEMPOTENCY_KEY_REQUIRED`
 * 2. 확인과 예약을 저장소의 `claim` 한 번으로 합니다. 같은 키의 기록이 있으면
 *    - 지문이 다르면 422 `IDEMPOTENCY_KEY_REUSED`
 *    - `COMPLETED`면 처음 응답을 그대로 돌려줍니다(`run`을 부르지 않습니다)
 *    - `IN_PROGRESS`면 409 `IDEMPOTENCY_KEY_IN_PROGRESS`
 *    - `UNCERTAIN`이면 같은 `reference`로 `run`을 다시 부릅니다(`resumed: true`)
 * 3. `run`이 성공하면 응답을 `COMPLETED`로 기록하고 `keepChanges`를 부릅니다. 외부 효과가 일어난 뒤 요청이 끊겨도 기록이 커밋되어
 *    재시도가 처음 응답을 돌려받습니다
 * 4. `run`이 {@link ExternalOutcomeUnknown}으로 실패하면 기록을 `UNCERTAIN`으로 남기고 `keepChanges`를 부릅니다
 * 5. 그 밖의 실패(검증·상태 오류, 외부 기관의 거절)와 결함이면 예약을 지웁니다. 같은 키로 요청을 고쳐 다시 보낼 수 있고, 그때는 새
 *    참조로 외부 기관을 부릅니다. 거절을 기록으로 남겨야 하면 `run`이 직접 `keepChanges`를 부릅니다. 이어 가던 시도가 이렇게 끝나면
 *    `UNCERTAIN` 기록도 지웁니다(외부 기관이 앞 시도를 거절했다고 답했거나, 리소스 상태가 이미 바뀌어 다시 처리할 수 없습니다).
 *    결함이면 SQLite가 요청을 되돌려 `UNCERTAIN`이 남습니다
 *
 * `run`은 중단할 수 없게 실행합니다. 외부 기관에 보낸 요청은 연결이 끊겨도 끝까지 받아 기록합니다.
 *
 * SQLite에서는 요청 하나가 `BEGIN IMMEDIATE` 트랜잭션이라 같은 키의 다음 요청은 앞 요청이 커밋한 뒤에야 확인하므로 `IN_PROGRESS`를
 * 볼 일이 없습니다. 메모리 저장소에서는 예약이 바로 보여 겹친 요청이 409를 받습니다.
 *
 * 응답은 JSON으로 저장했다 돌려주므로 `A`는 JSON으로 그대로 오가는 값(문자열·수·참거짓·`null`·배열·객체뿐인 응답)이어야 합니다.
 */
export const runIdempotent = <A, E, R>(
  request: IdempotentRequest,
  run: (attempt: IdempotentAttempt) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | IdempotencyKeyRequired | IdempotencyKeyReused | IdempotencyKeyInProgress, R> =>
  Effect.gen(function* () {
    const { store, key } = request
    if (key === undefined || key.trim() === '') return yield* new IdempotencyKeyRequired({})
    const id = idempotencyRecordId(request.companyId, request.actorUserId, key)
    const fingerprint = requestFingerprint({ operation: request.operation, request: request.request })
    const now = yield* Clock.currentTimeMillis
    const claim = yield* store.claim(id, (existing): readonly [Claim<A>, IdempotencyRecord | null] => {
      const live = Option.filter(existing, (record) => !idempotencyExpired(record.createdAt, now))
      if (Option.isNone(live)) {
        const fresh: IdempotencyRecord = {
          id,
          companyId: request.companyId,
          actorUserId: request.actorUserId,
          key,
          fingerprint,
          status: 'IN_PROGRESS',
          reference: randomUUID(),
          response: null,
          createdAt: new Date(now).toISOString(),
          finishedAt: null,
        }
        return [{ _tag: 'Start', record: fresh, resumed: false }, fresh]
      }
      const record = live.value
      if (record.fingerprint !== fingerprint) return [{ _tag: 'Reused' }, null]
      if (record.status === 'COMPLETED') return [{ _tag: 'Replay', response: record.response as A }, null]
      if (record.status === 'IN_PROGRESS') return [{ _tag: 'InProgress' }, null]
      const resumed: IdempotencyRecord = { ...record, status: 'IN_PROGRESS' }
      return [{ _tag: 'Start', record: resumed, resumed: true }, resumed]
    })
    switch (claim._tag) {
      case 'Reused':
        return yield* new IdempotencyKeyReused({})
      case 'InProgress':
        return yield* new IdempotencyKeyInProgress({})
      case 'Replay':
        return claim.response
      case 'Start':
        return yield* Effect.uninterruptible(attempt(request.store, claim.record, claim.resumed, run))
    }
  })

function attempt<A, E, R>(
  store: IdempotencyStore,
  reserved: IdempotencyRecord,
  resumed: boolean,
  run: (attempt: IdempotentAttempt) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(run({ reference: reserved.reference, resumed }))
    if (Exit.isSuccess(exit)) {
      const finishedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
      yield* store.save({ ...reserved, status: 'COMPLETED', response: exit.value, finishedAt })
      yield* keepChanges
      return exit.value
    }
    if (Option.isSome(Option.filter(Cause.findErrorOption(exit.cause), isOutcomeUnknown))) {
      yield* store.save({ ...reserved, status: 'UNCERTAIN' })
      yield* keepChanges
    } else {
      yield* store.remove(reserved.id)
      // 새 예약은 실패 응답과 함께 되돌려지면 그만이지만, 이어 가던 `UNCERTAIN` 기록은 되돌려지면 남습니다. 메모리 저장소와 같게 지웁니다.
      if (resumed) yield* keepChanges
    }
    return yield* exit
  })
}

function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof ExternalOutcomeUnknown
}

/**
 * 외부 기관을 부르는 구간(호출과 그 결과의 기록)을 감쌉니다. 그 안에서 결함이나 중단이 나면 결과를 모르는 것으로 보고
 * {@link ExternalOutcomeUnknown}(503)으로 바꿉니다. 결함 그대로 두면 SQLite가 요청 전체를 되돌려 예약도 사라지고, 같은 키의 재시도가
 * 새 참조로 외부 기관을 다시 부릅니다. 외부 기관이 돌려준 거절 같은 타입 있는 실패는 그대로 둡니다.
 */
export const outcomeUnknownOnDefect = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ExternalOutcomeUnknown, R> =>
  Effect.catchCause(effect, (cause): Effect.Effect<never, E | ExternalOutcomeUnknown> =>
    Cause.hasFails(cause)
      ? Effect.failCause(cause)
      : Effect.logWarning('External call ended without a confirmed result', { operation }).pipe(
          Effect.andThen(Effect.fail(new ExternalOutcomeUnknown({}))),
        ),
  )
