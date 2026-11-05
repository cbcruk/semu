import type { PlainDate } from './plain-date.types'

/** Source of the current time, injected so services and tests agree on "today". */
export interface Clock {
  /** Returns today's date in Asia/Seoul. */
  today(): PlainDate
  /** Returns the current instant as ISO 8601 with a `+09:00` offset. */
  now(): string
}
