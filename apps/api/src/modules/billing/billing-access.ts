import { Clock, Effect } from 'effect'
import { companyDate } from '../../shared/time/company-date.ts'

/** 회사 시간대의 오늘 날짜입니다. */
export const today: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) => companyDate(millis))

/** 지금 시각(RFC 3339, UTC)입니다. */
export const nowIso: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (millis) =>
  new Date(millis).toISOString(),
)
