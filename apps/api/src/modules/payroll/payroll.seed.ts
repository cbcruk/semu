import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../db/seed.types'
import { ensureRateTables } from './reference/rate-tables.repository'
import { ensurePayrollSettings } from './settings/settings.service'

/** Inserts the payroll domain's demo fixtures: the rate tables and the default settings of the demo corporation. */
export function seedPayrollDemo(db: DatabaseSync, context: SeedContext): void {
  ensureRateTables(db, context.now)
  ensurePayrollSettings(db, 'c-corp', context.now)
}
