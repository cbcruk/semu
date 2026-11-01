import { applyBasisPoints, splitVatFromTotal } from '../../lib/money'
import { fromParts, lastDayOfMonth, quarterOfMonth, toParts } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'
import type { BusinessType } from '../tax-calendar/tax-calendar.types'
import type { SalesEvidenceRow, SalesSource, VatPeriod } from './estimated-vat.types'

/** Sales sources summed into the estimate; mall and delivery may duplicate PG payments. */
export const INCLUDED_SALES_SOURCES: readonly SalesSource[] = ['tax_invoice', 'cash_receipt', 'card', 'pg']

/** Returns the estimate period containing a date: a quarter for corporations, a half for individuals. */
export function vatPeriodFor(businessType: BusinessType, on: PlainDate): VatPeriod {
  const { year, month } = toParts(on)
  if (businessType === 'corporate') {
    const quarter = quarterOfMonth(month)
    return { start: fromParts(year, quarter * 3 - 2, 1), end: lastDayOfMonth(year, quarter * 3), unit: 'quarter' }
  }
  return halfPeriod(year, month <= 6 ? 1 : 2)
}

/** Returns the half-year VAT taxable period. */
export function halfPeriod(year: number, half: 1 | 2): VatPeriod {
  return half === 1
    ? { start: fromParts(year, 1, 1), end: lastDayOfMonth(year, 6), unit: 'half' }
    : { start: fromParts(year, 7, 1), end: lastDayOfMonth(year, 12), unit: 'half' }
}

/**
 * Returns the output VAT of one sales record.
 *
 * Uses the recorded VAT when the source provides it; otherwise splits the
 * VAT-inclusive total and applies the company's taxable card ratio.
 */
export function salesVatOf(row: SalesEvidenceRow, taxableCardRatioBp: number): number {
  if (row.vat_amount !== null) return row.vat_amount
  return applyBasisPoints(splitVatFromTotal(row.total_amount), taxableCardRatioBp)
}

/** Keeps the first record of each `dedupe_group` and every ungrouped record. */
export function dedupeSales(rows: readonly SalesEvidenceRow[]): SalesEvidenceRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (row.dedupe_group === null) return true
    if (seen.has(row.dedupe_group)) return false
    seen.add(row.dedupe_group)
    return true
  })
}
