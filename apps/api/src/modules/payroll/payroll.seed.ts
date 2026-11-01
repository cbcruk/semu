import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../db/seed.types'

/** Inserts the payroll domain's demo fixtures on top of the shared companies and users. */
export function seedPayrollDemo(_db: DatabaseSync, _context: SeedContext): void {}
