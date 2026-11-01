import type { DatabaseSync } from 'node:sqlite'
import { queryAll, queryOne } from '../../db/query'
import { minDate } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'
import type { CompanyRow } from '../companies/companies.types'
import type {
  PurchaseEvidenceRow,
  SalesEvidenceRow,
  ScrapStatus,
  VatBreakdownEntry,
  VatEstimate,
  VatPeriod,
  VatTrendPoint,
} from './estimated-vat.types'
import { dedupeSales, halfPeriod, INCLUDED_SALES_SOURCES, salesVatOf, vatPeriodFor } from './estimated-vat.utils'

/**
 * Estimates the VAT for the period containing a date from collected evidence.
 *
 * Output tax sums the included sales sources once per `dedupe_group`; input
 * tax sums purchases marked deductible. Unclassified purchases are left out
 * and only counted, so the estimate errs on the high side.
 */
export function estimateVat(db: DatabaseSync, company: CompanyRow, on: PlainDate): VatEstimate {
  return estimateForPeriod(db, company, vatPeriodFor(company.business_type, on))
}

/**
 * Returns one VAT amount per half-year, preferring confirmed filings for taxation customers.
 *
 * @param years How many calendar years to include, ending with the current one.
 */
export function vatTrend(db: DatabaseSync, company: CompanyRow, years: number, today: PlainDate): VatTrendPoint[] {
  const currentYear = Number(today.slice(0, 4))
  const points: VatTrendPoint[] = []
  for (let year = currentYear - years + 1; year <= currentYear; year++) {
    for (const half of [1, 2] as const) {
      const period = halfPeriod(year, half)
      if (period.start > today) continue
      const confirmed = company.tax_plan === 'taxation' ? confirmedVat(db, company.id, year, half) : null
      if (confirmed !== null) {
        points.push({ year, half, amount: confirmed, source: 'confirmed' })
        continue
      }
      const estimate = estimateForPeriod(db, company, { ...period, end: minDate(period.end, today) })
      points.push({ year, half, amount: estimate.estimated_tax, source: 'estimated' })
    }
  }
  return points
}

function estimateForPeriod(db: DatabaseSync, company: CompanyRow, period: VatPeriod): VatEstimate {
  const sales = queryAll<SalesEvidenceRow>(
    db,
    'SELECT * FROM sales_evidence WHERE company_id = ? AND issued_on BETWEEN ? AND ? ORDER BY issued_on, id',
    [company.id, period.start, period.end],
  )
  const purchases = queryAll<PurchaseEvidenceRow>(
    db,
    'SELECT * FROM purchase_evidence WHERE company_id = ? AND issued_on BETWEEN ? AND ? ORDER BY issued_on, id',
    [company.id, period.start, period.end],
  )
  const breakdown = new Map<string, VatBreakdownEntry>()
  const entryFor = (side: VatBreakdownEntry['side'], source: VatBreakdownEntry['source'], included: boolean): VatBreakdownEntry => {
    const key = `${side}:${source}`
    let entry = breakdown.get(key)
    if (entry === undefined) {
      entry = { source, side, vat_amount: 0, included_in_total: included, last_synced_at: null, last_scrap_status: lastScrapStatus(db, company.id, source) }
      breakdown.set(key, entry)
    }
    return entry
  }

  let outputTax = 0
  let cardSplitEstimated = false
  for (const row of dedupeSales(sales)) {
    const included = INCLUDED_SALES_SOURCES.includes(row.source)
    const vat = salesVatOf(row, company.taxable_card_ratio_bp)
    const entry = entryFor('sales', row.source, included)
    entry.vat_amount += vat
    entry.last_synced_at = latest(entry.last_synced_at, row.synced_at)
    if (included) outputTax += vat
    if (included && row.vat_amount === null) cardSplitEstimated = true
  }

  let inputTax = 0
  let nonDeductible = 0
  let unclassified = 0
  for (const row of purchases) {
    const entry = entryFor('purchase', row.source, true)
    entry.last_synced_at = latest(entry.last_synced_at, row.synced_at)
    if (row.deductible === 1) {
      entry.vat_amount += row.vat_amount
      inputTax += row.vat_amount
    } else if (row.deductible === 0) {
      nonDeductible++
    } else {
      unclassified++
    }
  }

  const estimatedTax = outputTax - inputTax
  return {
    period,
    output_tax: outputTax,
    input_tax: inputTax,
    estimated_tax: estimatedTax,
    is_refund: estimatedTax < 0,
    card_split_estimated: cardSplitEstimated,
    breakdown: [...breakdown.values()],
    excluded: { non_deductible_count: nonDeductible, unclassified_count: unclassified },
  }
}

function confirmedVat(db: DatabaseSync, companyId: string, year: number, half: 1 | 2): number | null {
  const quarters = half === 1 ? [1, 2] : [3, 4]
  const finalFiled = queryOne<{ found: number }>(
    db,
    `SELECT 1 AS found FROM tax_filings WHERE company_id = ? AND tax_type = 'surtax' AND kind = 'final'
       AND year = ? AND quarter = ? AND status IN ('filed', 'settled')`,
    [companyId, year, quarters[1] ?? 0],
  )
  if (finalFiled === undefined) return null
  const sum = queryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(payable_amount), 0) AS total FROM tax_filings
     WHERE company_id = ? AND tax_type = 'surtax' AND kind IN ('preliminary', 'final')
       AND year = ? AND quarter IN (?, ?) AND status IN ('filed', 'settled')`,
    [companyId, year, quarters[0] ?? 0, quarters[1] ?? 0],
  )
  return sum?.total ?? 0
}

function lastScrapStatus(db: DatabaseSync, companyId: string, service: string): ScrapStatus | null {
  return (
    queryOne<{ status: ScrapStatus }>(
      db,
      'SELECT status FROM scrap_requests WHERE company_id = ? AND service = ? ORDER BY requested_at DESC LIMIT 1',
      [companyId, service],
    )?.status ?? null
  )
}

function latest(current: string | null, candidate: string): string {
  return current === null || candidate > current ? candidate : current
}
