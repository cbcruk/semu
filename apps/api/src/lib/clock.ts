import type { Clock } from './clock.types'
import { plainDateInZone } from './plain-date'
import type { PlainDate } from './plain-date.types'

const SEOUL = 'Asia/Seoul'
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000

/** Formats an instant as ISO 8601 in Korea Standard Time. */
export function toSeoulIso(instant: Date): string {
  return new Date(instant.getTime() + SEOUL_OFFSET_MS).toISOString().replace('Z', '+09:00')
}

/** Returns the calendar date in Asia/Seoul of an ISO 8601 instant. */
export function seoulDateOf(isoInstant: string): PlainDate {
  return plainDateInZone(new Date(isoInstant), SEOUL)
}

/** Creates a clock that reads the system time. */
export function systemClock(): Clock {
  return {
    today: (): PlainDate => plainDateInZone(new Date(), SEOUL),
    now: (): string => toSeoulIso(new Date()),
  }
}

/**
 * Creates a clock frozen at an instant, for tests and batch replays.
 *
 * @example Freezing time
 * ```ts
 * import { fixedClock } from './clock'
 *
 * const clock = fixedClock('2026-11-01T09:00:00+09:00')
 * clock.today() // '2026-11-01'
 * ```
 */
export function fixedClock(isoInstant: string): Clock {
  const instant = new Date(isoInstant)
  return {
    today: (): PlainDate => plainDateInZone(instant, SEOUL),
    now: (): string => toSeoulIso(instant),
  }
}
