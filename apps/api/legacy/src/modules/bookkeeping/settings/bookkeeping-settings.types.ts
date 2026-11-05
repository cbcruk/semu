/**
 * Which sales sources the 매출·매입 현황 report sums.
 *
 * - `all`: every source, one record per `dedupe_group`. PG and cash receipt
 *   duplicates are kept, matching the current product notice.
 * - `vat_included`: only the sources the estimated VAT sums.
 */
export type SalesStatusSources = 'all' | 'vat_included'

/** Amount the realtime profit and loss report uses for evidence: supply amount or VAT-inclusive total. */
export type RealtimePlBasis = 'supply' | 'total'

/** Per-company product decisions of the bookkeeping domain, with defaults from {@linkcode DEFAULT_BOOKKEEPING_POLICY}. */
export interface BookkeepingPolicy {
  salesStatusSources: SalesStatusSources
  realtimePlBasis: RealtimePlBasis
  /** Whether classified bank transactions without evidence (salary, rent, interest) count toward realtime P&L. */
  realtimePlIncludeBank: boolean
  /** Whether the company has premium settlement, which unlocks cash and financial position tax reports. */
  premiumSettlement: boolean
}

/** A row of `bookkeeping_settings`. */
export interface BookkeepingSettingsRow {
  company_id: string
  sales_status_sources: SalesStatusSources
  realtime_pl_basis: RealtimePlBasis
  realtime_pl_include_bank: 0 | 1
  premium_settlement: 0 | 1
  updated_at: string
}
