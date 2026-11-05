import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../app.types'
import type { SeedContext } from '../../db/seed.types'
import { fixedClock } from '../../lib/clock'
import { createMemoryFileStorage } from '../../lib/file-storage/memory-file-storage'
import { forceCardStatus } from './cards/cards.repository'
import { createCard, recalculateCard, type CardCaller } from './cards/cards.service'
import type { CardRow } from './cards/cards.types'
import { paymentMonthOf, WAGE_INCOME_TYPES } from './cards/cards.utils'
import { addCandidates, listCandidates } from './cards/rows.service'
import { ensureRateTables } from './reference/rate-tables.repository'
import { ensurePayrollSettings } from './settings/settings.service'
import { syncPayrollLedgerRequirement } from './withholding/withholding-link'

const DEMO_COMPANY = 'c-corp'
const SEED_CALLER: CardCaller = { actor: 'agency', userId: 'seed' }

/**
 * Inserts the payroll domain's demo fixtures for the demo corporation.
 *
 * - The rate tables and default payroll settings.
 * - An approved BPO card for October 2026 and an `inputting` card for
 *   November 2026, both filled with HR's seeded wage employees.
 *
 * Runs inside the seed transaction, after the HR seed.
 */
export function seedPayrollDemo(db: DatabaseSync, context: SeedContext): void {
  ensureRateTables(db, context.now)
  ensurePayrollSettings(db, DEMO_COMPANY, context.now)
  const deps: ServiceDeps = { db, clock: fixedClock(context.now), storage: createMemoryFileStorage(), cipher: context.cipher }
  const october = seedCard(deps, '2026-10')
  recalculateCard(db, october, context.now)
  forceCardStatus(db, DEMO_COMPANY, october.id, 'approved', context.now)
  syncPayrollLedgerRequirement(db, DEMO_COMPANY, paymentMonthOf(october.payment_date), context.now)
  seedCard(deps, '2026-11')
}

function seedCard(deps: ServiceDeps, attributionMonth: string): CardRow {
  const card = createCard(deps, DEMO_COMPANY, { generation: 'bpo', attributionMonth }, SEED_CALLER)
  for (const incomeType of WAGE_INCOME_TYPES) {
    const ids = listCandidates(deps, card, incomeType).map(({ employee }) => employee.id)
    if (ids.length > 0) addCandidates(deps, card, incomeType, ids, SEED_CALLER)
  }
  return card
}
