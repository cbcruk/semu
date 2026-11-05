import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll } from '../../../db/query'
import { PAYROLL_RATE_TABLES } from '../engine/rate-table-2026'
import { resolveRateTable } from '../engine/rate-table'
import type { PayrollRateTable, YearMonth } from '../engine/rate-table.types'

/**
 * Inserts the built-in rate tables that are missing from `payroll_rate_tables`.
 *
 * Existing rows are kept, so an operator can correct a table in the database
 * without the next start overwriting it.
 */
export function ensureRateTables(db: DatabaseSync, now: string): void {
  for (const table of PAYROLL_RATE_TABLES) {
    execute(db, 'INSERT OR IGNORE INTO payroll_rate_tables (effective_from, payload, created_at) VALUES (?, ?, ?)', [
      table.effectiveFrom,
      JSON.stringify(table),
      now,
    ])
  }
}

/** Loads every stored rate table, oldest first. */
export function loadRateTables(db: DatabaseSync): PayrollRateTable[] {
  return queryAll<{ payload: string }>(db, 'SELECT payload FROM payroll_rate_tables ORDER BY effective_from').map(
    (row) => JSON.parse(row.payload) as PayrollRateTable,
  )
}

/**
 * Loads the rate table in force in a month.
 *
 * @throws {RangeError} When no stored table starts on or before the month.
 */
export function rateTableFor(db: DatabaseSync, month: YearMonth): PayrollRateTable {
  return resolveRateTable(loadRateTables(db), month)
}
