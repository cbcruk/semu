import { addDays, dayOfWeek } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'

/**
 * Moves a deadline past weekends and holidays (Framework Act on National Taxes, Article 5).
 *
 * Repeats until it lands on a business day, so consecutive holidays roll over together.
 *
 * @example Saturday deadline
 * ```ts
 * import { applyDeadlineRollover } from './tax-calendar.utils'
 *
 * applyDeadlineRollover('2026-07-25' as PlainDate, new Set()) // '2026-07-27'
 * ```
 */
export function applyDeadlineRollover(date: PlainDate, holidays: ReadonlySet<PlainDate>): PlainDate {
  let current = date
  while (isNonBusinessDay(current, holidays)) current = addDays(current, 1)
  return current
}

/** Checks whether a date is a weekend or a listed holiday. */
export function isNonBusinessDay(date: PlainDate, holidays: ReadonlySet<PlainDate>): boolean {
  const weekday = dayOfWeek(date)
  return weekday === 0 || weekday === 6 || holidays.has(date)
}
