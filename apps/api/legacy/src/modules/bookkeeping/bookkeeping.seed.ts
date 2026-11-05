import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../db/seed.types'
import { seedGiroDemo } from './giros/giros.seed'
import { seedLedgerDemo } from './ledger.seed'
import { seedSettlementDemo } from './settlement/settlement.seed'
import { seedTransactionSalesDemo } from './transaction-sales/transaction-sales.seed'

/**
 * Inserts the bookkeeping domain's demo fixtures on top of the shared companies and users.
 *
 * Existing evidence rows keep their amounts and deductibility, so the
 * estimated VAT of the shared seed does not move.
 */
export function seedBookkeepingDemo(db: DatabaseSync, context: SeedContext): void {
  seedLedgerDemo(db, context)
  seedTransactionSalesDemo(db, context)
  seedGiroDemo(db, context)
  seedSettlementDemo(db, context)
}
