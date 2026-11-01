import type { PlainDate } from '../../lib/plain-date.types'

/** Source of a sales record. */
export type SalesSource = 'tax_invoice' | 'cash_receipt' | 'card' | 'pg' | 'mall' | 'delivery'

/** Source of a purchase record. */
export type PurchaseSource = 'tax_invoice' | 'cash_receipt' | 'card'

/** Status values of the legacy scrape request enum. */
export type ScrapStatus = 'request' | 'done' | 'timeout'

/** The period an estimate covers. */
export interface VatPeriod {
  start: PlainDate
  end: PlainDate
  unit: 'quarter' | 'half'
}

/** A row of `sales_evidence`. */
export interface SalesEvidenceRow {
  id: string
  source: SalesSource
  issued_on: PlainDate
  total_amount: number
  vat_amount: number | null
  dedupe_group: string | null
  synced_at: string
}

/** A row of `purchase_evidence`. */
export interface PurchaseEvidenceRow {
  id: string
  source: PurchaseSource
  vat_amount: number
  deductible: 0 | 1 | null
  synced_at: string
}

/** VAT total and freshness for one source on one side. */
export interface VatBreakdownEntry {
  source: SalesSource | PurchaseSource
  side: 'sales' | 'purchase'
  vat_amount: number
  included_in_total: boolean
  last_synced_at: string | null
  last_scrap_status: ScrapStatus | null
}

/** The estimated VAT response body. */
export interface VatEstimate {
  period: VatPeriod
  output_tax: number
  input_tax: number
  estimated_tax: number
  is_refund: boolean
  card_split_estimated: boolean
  breakdown: VatBreakdownEntry[]
  excluded: { non_deductible_count: number; unclassified_count: number }
}

/** One point of the yearly VAT trend. */
export interface VatTrendPoint {
  year: number
  half: 1 | 2
  amount: number
  source: 'confirmed' | 'estimated'
}
