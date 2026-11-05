import { DateTime, Effect } from 'effect'
import { companyDate } from '../../shared/time/company-date.ts'

/** 지금 시각(RFC 3339)과 회사 시간대 오늘(`YYYY-MM-DD`)입니다. 요청 하나에서 한 번만 읽습니다. */
export interface TaxInstant {
  now: string
  today: string
}

/** 시계에서 {@link TaxInstant}를 읽습니다. 테스트는 `TestClock`으로 시각을 정할 수 있습니다. */
export const currentInstant: Effect.Effect<TaxInstant> = Effect.map(DateTime.now, (now) => ({
  now: DateTime.formatIso(now),
  today: companyDate(DateTime.toEpochMillis(now)),
}))

/**
 * 내림차순 목록의 커서 키입니다. 글자마다 코드값을 뒤집어, 오름차순 커서(`paginate`)로 내림차순을 읽게 합니다.
 *
 * 같은 길이의 문자열(ISO 시각, ULID)끼리만 순서가 맞습니다.
 */
export function descendingKey(value: string): string {
  return [...value].map((char) => String.fromCharCode(0xffff - char.charCodeAt(0))).join('')
}
