import { DateTime, Effect, Option } from 'effect'
import { companyDate } from '../../../shared/time/company-date.ts'

/** 찾은 값을 돌려주고, 없으면 `onMissing`의 오류로 실패합니다. */
export function orFail<A, E>(found: Effect.Effect<Option.Option<A>>, onMissing: () => E): Effect.Effect<A, E> {
  return Effect.flatMap(found, Option.match({ onNone: () => Effect.fail(onMissing()), onSome: Effect.succeed }))
}

/** 지금 시각(RFC 3339)과 회사 시간대의 오늘입니다. */
export const nowAndToday: Effect.Effect<{ now: string; today: string }> = Effect.map(DateTime.now, (now) => ({
  now: DateTime.formatIso(now),
  today: companyDate(DateTime.toEpochMillis(now)),
}))

/**
 * 최신순 목록의 커서 정렬 키입니다. 날짜 숫자를 뒤집어 문자열 오름차순이 날짜 내림차순이 되게 합니다.
 *
 * 같은 날짜 안에서는 ID 오름차순입니다.
 */
export function newestFirstKey(date: string, id: string): string {
  return `${date.replace(/\d/g, (digit) => String(9 - Number(digit)))}|${id}`
}
