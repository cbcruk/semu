import { Clock, Effect } from 'effect'
import { IdempotencyKeyRequired } from '../../shared/problem/problem.ts'
import { companyDate } from '../../shared/time/company-date.ts'

/** 회사 시간대의 오늘 날짜입니다. */
export const today: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) => companyDate(millis))

/** 지금 시각(RFC 3339, UTC)입니다. */
export const nowIso: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) =>
  new Date(millis).toISOString(),
)

/** 외부 효과가 있는 커맨드에 `Idempotency-Key`가 없으면 428로 실패합니다. 같은 키의 재요청 재생은 아직 하지 않습니다. */
export const requireIdempotencyKey = (key: string | undefined): Effect.Effect<void, IdempotencyKeyRequired> =>
  key === undefined || key.length === 0 ? Effect.fail(new IdempotencyKeyRequired({})) : Effect.void
