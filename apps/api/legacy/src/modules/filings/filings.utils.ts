import { TAX_TYPE_PATH_SEGMENT } from '../access/menu-codes'
import type { TaxType } from '../tax-calendar/tax-calendar.types'
import type { DocType, FilingRow, FilingStatus } from './filings.types'

/** User-facing names of each tax type. */
export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  surtax: '부가세',
  withholding_tax: '원천세',
  corporation_tax: '법인세',
  aggr_income_tax: '종합소득세',
}

const LEDGER_VISIBLE: readonly FilingStatus[] = ['ledger_pending', 'preparing', 'filed', 'settled']
const RESULT_VISIBLE: readonly FilingStatus[] = ['filed', 'settled']

/** Describes a filing's period for card titles, e.g. `2026년 4분기` or `2026년 10월`. */
export function periodLabel(filing: FilingRow): string {
  if (filing.kind === 'monthly') return `${filing.year}년 ${Number(filing.period_start.slice(5, 7))}월`
  if (filing.kind === 'annual') return `${filing.year}년`
  if (filing.kind === 'semiannual') return `${filing.year}년 ${filing.quarter === 2 ? '상반기' : '하반기'}`
  return filing.quarter === null ? `${filing.year}년` : `${filing.year}년 ${filing.quarter}분기`
}

/** Returns the client route of a tax type's menu, kept identical to the legacy path. */
export function ctaPathOf(taxType: TaxType): string {
  return `/tax/${TAX_TYPE_PATH_SEGMENT[taxType]}`
}

/** Checks whether a client may see a document of a given type while the filing is in a status. */
export function isDocumentVisibleToClient(docType: DocType, status: FilingStatus): boolean {
  return docType === 'ledger' ? LEDGER_VISIBLE.includes(status) : RESULT_VISIBLE.includes(status)
}

/** Returns the date part of an ISO 8601 timestamp, or `null`. */
export function datePart(timestamp: string | null): string | null {
  return timestamp === null ? null : timestamp.slice(0, 10)
}
