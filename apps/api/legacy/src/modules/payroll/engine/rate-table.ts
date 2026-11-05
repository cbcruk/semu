import type { PayrollRateTable, YearMonth } from './rate-table.types'

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
const TARGET_DATE = /^(?!0000)(\d{4})(0[1-9]|1[0-2])$/

/** Checks whether a string is a {@linkcode YearMonth} in `YYYY-MM` form. */
export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH.test(value)
}

/**
 * Converts the client's `target_date` parameter (`YYYYMM`) to a {@linkcode YearMonth}.
 *
 * @returns The month, or `undefined` when the value does not match `YYYYMM`.
 */
export function yearMonthFromTargetDate(targetDate: string): YearMonth | undefined {
  const match = TARGET_DATE.exec(targetDate)
  return match === null ? undefined : `${match[1]}-${match[2]}`
}

/**
 * Picks the rate table in force in a month: the latest one whose `effectiveFrom` is not after it.
 *
 * @throws {RangeError} When no table starts on or before the month.
 *
 * @example Resolving the July 2026 table
 * ```ts
 * import { resolveRateTable } from './rate-table'
 * import { PAYROLL_RATE_TABLES } from './rate-table-2026'
 *
 * resolveRateTable(PAYROLL_RATE_TABLES, '2026-09').effectiveFrom // '2026-07'
 * ```
 */
export function resolveRateTable(tables: readonly PayrollRateTable[], month: YearMonth): PayrollRateTable {
  let match: PayrollRateTable | undefined
  for (const table of tables) {
    if (table.effectiveFrom <= month && (match === undefined || table.effectiveFrom > match.effectiveFrom)) match = table
  }
  if (match === undefined) throw new RangeError(`No payroll rate table is in force in ${month}`)
  return match
}

/** Lists the dotted paths of rate-table values that are not confirmed by the spec. */
export function unverifiedRatePaths(table: PayrollRateTable): string[] {
  return Object.entries(table.verification)
    .filter(([, entry]) => !entry.verified)
    .map(([path]) => path)
}
