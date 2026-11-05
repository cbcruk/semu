import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'

/** A required `YYYY-MM-DD` date. */
export const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)

/** An optional date that may also be `null` or an empty string, both meaning "not set". */
export const nullableDate = z
  .union([z.literal(''), z.null(), plainDate])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value))

/** A non-negative amount in whole won. */
export const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')

/** A nullable non-negative amount in whole won. */
export const nullableWon = won.nullable().optional().transform((value) => value ?? null)

/** Optional free text trimmed, where an empty string means `null`. */
export const nullableText = (max: number): z.ZodType<string | null> =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)) as unknown as z.ZodType<string | null>

/** A boolean that also accepts the strings `true`/`false`/`True`/`False`, as multipart and query strings send them. */
export const looseBoolean = z.union([z.boolean(), z.enum(['true', 'false', 'True', 'False', '1', '0'])]).transform((value) =>
  typeof value === 'boolean' ? value : value === 'true' || value === 'True' || value === '1',
)

/** Pagination query parameters. */
export const pageQuery = z.object({ limit: z.string().optional(), offset: z.string().optional() })
