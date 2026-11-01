import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../db/seed.types'

/** Inserts the hr domain's demo fixtures on top of the shared companies and users. */
export function seedHrDemo(_db: DatabaseSync, _context: SeedContext): void {}
