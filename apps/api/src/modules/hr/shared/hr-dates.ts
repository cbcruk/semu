import { addDays, lastDayOfMonth } from '../../../shared/time/calendar.ts'

/**
 * `date`(`YYYY-MM-DD`)에서 `months`달 뒤의 같은 날입니다. 그 달에 같은 날이 없으면 말일로 맞춥니다.
 *
 * @example 말일 맞춤
 * ```ts
 * addMonthsToDate('2026-01-31', 1) // '2026-02-28'
 * ```
 */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const index = y * 12 + (m - 1) + months
  const month = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
  const last = lastDayOfMonth(month)
  return Number(last.slice(8)) < d ? last : `${month}-${String(d).padStart(2, '0')}`
}

/** 두 날짜 중 이른 날입니다. */
export function minDate(a: string, b: string): string {
  return a < b ? a : b
}

/** 두 날짜 중 늦은 날입니다. */
export function maxDate(a: string, b: string): string {
  return a > b ? a : b
}

/** `date` 하루 전입니다. */
export function previousDay(date: string): string {
  return addDays(date, -1)
}
