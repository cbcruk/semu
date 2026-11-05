import { splitVatFromTotal } from '../../../lib/money'
import type { RuleFacts } from '../classification/classification.types'
import type { EvidenceAmounts, EvidenceRow, EvidenceSide } from './evidence.types'

/** Table that stores each evidence side. */
export const EVIDENCE_TABLE: Record<EvidenceSide, 'sales_evidence' | 'purchase_evidence'> = {
  sales: 'sales_evidence',
  purchase: 'purchase_evidence',
}

/** Route segments of the evidence tabs mapped to stored sources; the 쇼핑몰 tab `online` is stored as `mall`. */
export const SOURCE_ALIASES: Record<string, string> = { online: 'mall' }

/**
 * Derives the total, supply and VAT amounts of an evidence row.
 *
 * Sales store a VAT-inclusive total and may lack supply and VAT (card sales);
 * purchases store supply and VAT and may lack the total. Missing VAT is split
 * from the total with {@linkcode splitVatFromTotal}, the same rule the
 * estimated VAT uses.
 */
export function evidenceAmounts(row: Pick<EvidenceRow, 'total_amount' | 'supply_amount' | 'vat_amount'>): EvidenceAmounts {
  if (row.total_amount !== null) {
    const vat = row.vat_amount ?? (row.supply_amount === null ? splitVatFromTotal(row.total_amount) : row.total_amount - row.supply_amount)
    return { total: row.total_amount, supply: row.supply_amount ?? row.total_amount - vat, vat }
  }
  const supply = row.supply_amount ?? 0
  const vat = row.vat_amount ?? 0
  return { total: supply + vat, supply, vat }
}

/** Gathers the values classification rules look at from an evidence row. */
export function evidenceFacts(row: EvidenceRow): RuleFacts {
  const amounts = evidenceAmounts(row)
  return {
    partner: row.partner_id,
    counterparty: `${row.counterparty_name ?? ''} ${row.counterparty_business_number ?? ''}`.trim(),
    item: row.item_summary ?? '',
    total_amount: amounts.total,
    supply_amount: amounts.supply,
    vat_amount: amounts.vat,
    source: row.source,
    summary: '',
    amount: amounts.total,
    account: null,
    direction: null,
  }
}
