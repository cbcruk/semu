import type { Cipher } from '../../../lib/crypto/crypto.types'
import type { PurchaseSource, SalesSource } from '../../estimated-vat/estimated-vat.types'
import type { BankAccountType } from '../bank/bank.types'
import type { EvidenceDocType, EvidenceKind } from '../evidence/evidence.types'
import type { GiroUpsertResult, ScrapedGiroBill } from '../giros/giros.types'

/** Fields shared by scraped sales and purchase evidence. */
interface ScrapedEvidenceBase {
  /** Idempotency key within the source: the approval number for tax invoices, approval number + card number + time for cards. */
  external_key: string
  issued_on: string
  written_on?: string | undefined
  doc_type?: EvidenceDocType | undefined
  evidence_kind?: EvidenceKind | undefined
  counterparty_business_number?: string | undefined
  counterparty_name?: string | undefined
  item_summary?: string | undefined
  items?: unknown[] | undefined
  card_number_masked?: string | undefined
  card_company_code?: string | undefined
  approval_no?: string | undefined
  is_canceled?: boolean | undefined
}

/** A sales record from hometax, cardsales, PG, delivery or allra; cancellations carry negative amounts. */
export interface ScrapedSalesEvidence extends ScrapedEvidenceBase {
  kind: 'sales_evidence'
  source: SalesSource
  total_amount: number
  supply_amount?: number | undefined
  vat_amount?: number | undefined
  channel?: string | undefined
  dedupe_group?: string | undefined
}

/** A purchase record from hometax or a corporate card. */
export interface ScrapedPurchaseEvidence extends ScrapedEvidenceBase {
  kind: 'purchase_evidence'
  source: PurchaseSource
  supply_amount: number
  vat_amount: number
  total_amount?: number | undefined
  deductible?: boolean | undefined
}

/** A card approval from the creditcard integration; stored as purchase evidence with source `card`. */
export interface ScrapedCardTransaction {
  kind: 'card_transaction'
  card_number_masked: string
  approval_no: string
  /** Approval time in ISO 8601; its date becomes `issued_on`. */
  approved_at: string
  card_company_code?: string | undefined
  merchant_name?: string | undefined
  merchant_business_number?: string | undefined
  total_amount: number
  vat_amount?: number | undefined
  is_canceled?: boolean | undefined
}

/** A bank account reported by the bank integration. */
export interface ScrapedBankAccount {
  kind: 'bank_account'
  bank_code: string
  account_number: string
  account_type: BankAccountType
  integration_id?: string | undefined
  account_name?: string | undefined
  is_corporate?: boolean | undefined
  currency_code?: string | undefined
  holder?: string | undefined
  open_date?: string | undefined
  end_date?: string | undefined
  /** Balance in KRW; foreign currency accounts send the converted value. */
  balance?: number | undefined
  balance_fx?: string | undefined
  fx_rate?: string | undefined
  is_dormant?: boolean | undefined
  is_active?: boolean | undefined
  external_key?: string | undefined
  /** Date the balance was read, recorded as a scraped daily closing balance. */
  balance_date?: string | undefined
}

/** One deposit or withdrawal; `amount` is signed, negative for withdrawals. */
export interface ScrapedBankTransaction {
  kind: 'bank_transaction'
  bank_code: string
  account_number: string
  external_key: string
  /** Time of the transaction in ISO 8601 or `YYYY-MM-DD HH:mm`. */
  transacted_at: string
  amount: number
  balance_after?: number | undefined
  summary?: string | undefined
  currency_code?: string | undefined
  amount_fx?: string | undefined
}

/** A closing balance reported for a date. */
export interface ScrapedBankBalance {
  kind: 'bank_balance'
  bank_code: string
  account_number: string
  date: string
  closing_balance: number
}

/** A full refresh of the internet giro bill list; bills missing from it move from `todo` to `unknown`. */
export interface ScrapedGiroBills {
  kind: 'giro_bills'
  bills: ScrapedGiroBill[]
}

/** A scraped record the bookkeeping domain stores. */
export type ScrapedRecord =
  | ScrapedSalesEvidence
  | ScrapedPurchaseEvidence
  | ScrapedCardTransaction
  | ScrapedBankAccount
  | ScrapedBankTransaction
  | ScrapedBankBalance
  | ScrapedGiroBills

/** What {@linkcode ingestScrapedRecords} needs besides the database. */
export interface IngestContext {
  /** Timestamp stored as `synced_at`. */
  now: string
  /** Encrypts bank account numbers. */
  cipher: Cipher
}

/** Insert and update counts of one record kind. */
export interface IngestCounts {
  inserted: number
  updated: number
}

/** Outcome of an ingestion batch. */
export interface IngestResult {
  sales_evidence: IngestCounts
  purchase_evidence: IngestCounts
  bank_accounts: IngestCounts
  bank_transactions: IngestCounts
  bank_balances: number
  giros: GiroUpsertResult | null
  /** Rows the classification rules classified among the newly inserted ones. */
  classified: { sales: number; purchase: number; bank: number }
  /** Records that could not be stored, by position in the batch. */
  rejected: { index: number; reason: string }[]
}
