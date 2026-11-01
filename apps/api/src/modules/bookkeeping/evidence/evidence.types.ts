import type { PurchaseSource, SalesSource } from '../../estimated-vat/estimated-vat.types'

/** Which evidence table a request addresses. */
export type EvidenceSide = 'sales' | 'purchase'

/** Kind of tax document, mapped from `InvoiceClass` 01–04. */
export type EvidenceDocType = 'tax_invoice' | 'modified_tax_invoice' | 'invoice' | 'modified_invoice'

/** Tax invoice kind, mapped from `InvoiceKind` 01–04. */
export type EvidenceKind = 'normal' | 'zero_rate' | 'delegation' | 'zero_rate_delegation'

/** Columns shared by `sales_evidence` and `purchase_evidence` after the bookkeeping migration. */
export interface EvidenceRow {
  id: string
  company_id: string
  source: SalesSource | PurchaseSource
  issued_on: string
  total_amount: number | null
  supply_amount: number | null
  vat_amount: number | null
  synced_at: string
  external_key: string | null
  doc_type: EvidenceDocType | null
  kind: EvidenceKind | null
  written_on: string | null
  counterparty_business_number: string | null
  counterparty_name: string | null
  partner_id: string | null
  item_summary: string | null
  items: string | null
  account_title_id: string | null
  classified_by: 'manual' | 'rule' | null
  classified_rule_id: string | null
  memo: string | null
  card_number_masked: string | null
  card_company_code: string | null
  approval_no: string | null
  is_canceled: 0 | 1
  dedupe_group?: string | null
  channel?: string | null
  sales_transaction_id?: string | null
  deductible?: 0 | 1 | null
  account_code?: string | null
}

/** The supply, VAT and total amounts of an evidence row, with missing values derived. */
export interface EvidenceAmounts {
  total: number
  supply: number
  vat: number
}

/** One evidence record in wire shape. */
export interface Evidence {
  id: string
  side: EvidenceSide
  source: string
  doc_type: EvidenceDocType | null
  kind: EvidenceKind | null
  written_on: string
  issued_on: string
  counterparty_name: string | null
  counterparty_business_number: string | null
  partner_id: string | null
  partner_name: string | null
  item_summary: string | null
  total_amount: number
  supply_amount: number
  vat_amount: number
  account_title_id: string | null
  account_title_name: string | null
  classified_by: 'manual' | 'rule' | null
  classified_rule_id: string | null
  memo: string | null
  deductible: boolean | null
  card_number_masked: string | null
  card_company_code: string | null
  approval_no: string | null
  channel: string | null
  is_canceled: boolean
  dedupe_group: string | null
  sales_transaction_id: string | null
  synced_at: string
}

/** Filters of the evidence list, already validated. */
export interface EvidenceFilter {
  sources: string[]
  start: string
  end: string
  classification: 'classified' | 'unclassified' | undefined
  accountTitleIds: string[]
  docType: EvidenceDocType | undefined
  kind: EvidenceKind | undefined
  partnerId: string | undefined
  search: string | undefined
}

/** Sort keys of the evidence list; a leading `-` sorts descending. */
export type EvidenceSort = 'written_on' | '-written_on' | 'issued_on' | '-issued_on' | 'total_amount' | '-total_amount'

/** Tab counts shown above the evidence list. */
export interface ClassificationCounts {
  all: number
  classified: number
  unclassified: number
}

/** Changes a user may make to one evidence record. */
export interface EvidencePatch {
  account_title_id?: string | null | undefined
  partner_id?: string | null | undefined
  memo?: string | null | undefined
  deductible?: boolean | null | undefined
}
