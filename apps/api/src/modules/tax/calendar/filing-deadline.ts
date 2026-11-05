import { addDays, weekdayIndex } from '../../../shared/time/calendar.ts'

/**
 * 기한이 토요일·일요일·공휴일이면 다음 영업일로 미룹니다 (국세기본법 제5조).
 *
 * 미룬 날도 쉬는 날이면 계속 미루므로, 주말에 이어진 연휴도 한 번에 넘어갑니다.
 *
 * @example 토요일 기한
 * ```ts
 * rollForwardDeadline('2026-07-25', new Set()) // '2026-07-27'
 * ```
 */
export function rollForwardDeadline(date: string, holidays: ReadonlySet<string>): string {
  let current = date
  while (isNonBusinessDay(current, holidays)) current = addDays(current, 1)
  return current
}

/** 주말이거나 `holidays`에 있는 날인지입니다. */
export function isNonBusinessDay(date: string, holidays: ReadonlySet<string>): boolean {
  const weekday = weekdayIndex(date)
  return weekday === 0 || weekday === 6 || holidays.has(date)
}
