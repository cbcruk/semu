import type { MiddlewareHandler } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { AppDeps, AppEnv } from '../../../app.types'
import { execute, queryOne } from '../../../db/query'
import { DomainError } from '../../../lib/domain-error'
import { PROMOTION_URL } from '../../access/promotion'
import type { BookkeepingPolicy, BookkeepingSettingsRow } from './bookkeeping-settings.types'

/**
 * Product decisions applied when a company has no `bookkeeping_settings` row.
 *
 * Each value is a decision the spec leaves open; see `docs/design/bookkeeping.md`.
 */
export const DEFAULT_BOOKKEEPING_POLICY: Readonly<BookkeepingPolicy> = {
  salesStatusSources: 'all',
  realtimePlBasis: 'supply',
  realtimePlIncludeBank: true,
  premiumSettlement: false,
}

/** Loads a company's bookkeeping policy, falling back to {@linkcode DEFAULT_BOOKKEEPING_POLICY}. */
export function loadBookkeepingPolicy(db: DatabaseSync, companyId: string): BookkeepingPolicy {
  const row = queryOne<BookkeepingSettingsRow>(db, 'SELECT * FROM bookkeeping_settings WHERE company_id = ?', [companyId])
  if (row === undefined) return { ...DEFAULT_BOOKKEEPING_POLICY }
  return {
    salesStatusSources: row.sales_status_sources,
    realtimePlBasis: row.realtime_pl_basis,
    realtimePlIncludeBank: row.realtime_pl_include_bank === 1,
    premiumSettlement: row.premium_settlement === 1,
  }
}

/** Stores a company's bookkeeping policy, replacing the previous values. */
export function saveBookkeepingPolicy(db: DatabaseSync, companyId: string, policy: BookkeepingPolicy, now: string): void {
  execute(
    db,
    `INSERT INTO bookkeeping_settings (company_id, sales_status_sources, realtime_pl_basis, realtime_pl_include_bank, premium_settlement, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET sales_status_sources = excluded.sales_status_sources,
       realtime_pl_basis = excluded.realtime_pl_basis, realtime_pl_include_bank = excluded.realtime_pl_include_bank,
       premium_settlement = excluded.premium_settlement, updated_at = excluded.updated_at`,
    [companyId, policy.salesStatusSources, policy.realtimePlBasis, policy.realtimePlIncludeBank ? 1 : 0, policy.premiumSettlement ? 1 : 0, now],
  )
}

/**
 * Rejects client requests for premium-only tax reports when the company lacks premium settlement.
 *
 * Assigned agency staff always pass, so they can check an upload before the customer upgrades.
 */
export function requirePremiumSettlement(deps: Pick<AppDeps, 'db'>): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    if (c.var.access.actor !== 'agency' && !loadBookkeepingPolicy(deps.db, c.var.company.id).premiumSettlement) {
      throw new DomainError('ENTITLEMENT_REQUIRED', 'This report requires premium settlement.', { promotion_url: PROMOTION_URL })
    }
    await next()
  }
}
