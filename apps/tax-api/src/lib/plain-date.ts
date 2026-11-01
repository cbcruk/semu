import type { DateParts, PlainDate } from './plain-date.types'

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** Checks whether a string is a real calendar date in `YYYY-MM-DD` form. */
export function isPlainDate(value: string): value is PlainDate {
  const match = PLAIN_DATE_PATTERN.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/**
 * Narrows a string to {@linkcode PlainDate}.
 *
 * @throws {RangeError} When the string is not a valid calendar date.
 */
export function toPlainDate(value: string): PlainDate {
  if (!isPlainDate(value)) throw new RangeError(`Invalid plain date: ${value}`)
  return value
}

/** Builds a {@linkcode PlainDate} from numeric parts, normalising overflowing days and months. */
export function fromParts(year: number, month: number, day: number): PlainDate {
  const date = new Date(Date.UTC(year, month - 1, day))
  return formatUtc(date)
}

/** Splits a {@linkcode PlainDate} into numeric parts. */
export function toParts(date: PlainDate): DateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  }
}

/** Returns the number of days in a month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Returns the last day of a month. */
export function lastDayOfMonth(year: number, month: number): PlainDate {
  return fromParts(year, month, daysInMonth(year, month))
}

/** Adds a number of days, which may be negative. */
export function addDays(date: PlainDate, days: number): PlainDate {
  const { year, month, day } = toParts(date)
  return fromParts(year, month, day + days)
}

/** Adds months, clamping the day to the end of the target month. */
export function addMonths(date: PlainDate, months: number): PlainDate {
  const { year, month, day } = toParts(date)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const targetYear = target.getUTCFullYear()
  const targetMonth = target.getUTCMonth() + 1
  return fromParts(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

/** Returns the weekday, where 0 is Sunday and 6 is Saturday. */
export function dayOfWeek(date: PlainDate): number {
  const { year, month, day } = toParts(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Returns the whole number of days from `from` to `to`. */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  const a = toParts(from)
  const b = toParts(to)
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS)
}

/** Returns the earlier of two dates. */
export function minDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b
}

/** Returns the quarter (1–4) that a month falls in. */
export function quarterOfMonth(month: number): number {
  return Math.ceil(month / 3)
}

/** Returns the calendar date of an instant in the given IANA time zone. */
export function plainDateInZone(instant: Date, timeZone: string): PlainDate {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
  return toPlainDate(formatted)
}

function formatUtc(date: Date): PlainDate {
  return toPlainDate(date.toISOString().slice(0, 10))
}
