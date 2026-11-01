import type { Context } from 'hono'
import { z } from 'zod'
import { invalidField } from '../../lib/domain-error'
import { isPlainDate, lastDayOfMonth, toParts, toPlainDate } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'

/** Zod schema for a `YYYY-MM-DD` query value. */
export const plainDateParam = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)

/**
 * Zod schema for a query parameter that may repeat (`?id=a&id=b`), as remittance-api clients send arrays.
 *
 * Comma-separated values are split too, so `?id=a,b` works the same.
 */
export const stringListParam = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]).flatMap((item) => item.split(',')).filter((item) => item !== ''))

/**
 * Reads a JSON body that may be empty, as with `DELETE` requests.
 *
 * @param fallback Returned when the body is empty.
 * @throws {DomainError} `VALIDATION_FAILED` when the body is not valid JSON.
 */
export async function readOptionalJson(request: Request, fallback: unknown): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return fallback
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidField('non_field_errors', 'The body must be valid JSON.')
  }
}

/**
 * Resolves an optional `start_date`/`end_date` pair, defaulting to the month that contains today.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the range is reversed.
 */
export function resolveDateRange(start: PlainDate | undefined, end: PlainDate | undefined, today: PlainDate): { start: PlainDate; end: PlainDate } {
  const { year, month } = toParts(today)
  const range = {
    start: start ?? toPlainDate(`${today.slice(0, 7)}-01`),
    end: end ?? lastDayOfMonth(year, month),
  }
  if (range.start > range.end) throw invalidField('start_date', 'start_date must not be after end_date.')
  return range
}

/**
 * Serializes rows as CSV with a UTF-8 byte order mark so spreadsheet apps detect Korean text.
 *
 * @example Two rows
 * ```ts
 * import { toCsv } from './bookkeeping.utils'
 *
 * toCsv([['이름', '금액'], ['식대, 점심', 12000]]) // '﻿이름,금액\r\n"식대, 점심",12000\r\n'
 * ```
 */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (value: string | number | null): string => {
    if (value === null) return ''
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`
}

/** Sends CSV text as a download. */
export function csvResponse(c: Context, fileName: string, csv: string): Response {
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'private, no-store',
  })
}
