/** `AccountType` of the bank integration: 01 demand deposit, 02 savings, 11 trust, 21 fund, 31 foreign currency or gold, 41 loan, 51 insurance, 61 pension. */
export type BankAccountType = '01' | '02' | '11' | '21' | '31' | '41' | '51' | '61'

/** Whether a bank transaction is linked to the evidence it settles. */
export type SettlementStatus = 'partner_required' | 'unmatched' | 'matched' | 'not_applicable'

/** A row of `bank_accounts`. */
export interface BankAccountRow {
  id: string
  company_id: string
  integration_id: string | null
  bank_code: string
  account_number_enc: string
  account_number_digest: string
  account_number_tail: string
  account_name: string | null
  account_type: BankAccountType
  is_corporate: 0 | 1
  currency_code: string
  holder: string | null
  open_date: string | null
  end_date: string | null
  balance: number | null
  balance_fx: string | null
  fx_rate: string | null
  is_dormant: 0 | 1
  is_active: 0 | 1
  is_visible_on_cash_report: 0 | 1
  last_transaction_date: string | null
  external_key: string | null
  created_at: string
  updated_at: string
}

/** A bank account in wire shape; the number is masked except its last six digits. */
export interface BankAccount {
  id: string
  integration_id: string | null
  bank_code: string
  account_number: string
  account_name: string | null
  account_type: BankAccountType
  is_corporate: boolean
  currency_code: string
  holder: string | null
  open_date: string | null
  end_date: string | null
  balance: number
  balance_fx: string | null
  fx_rate: string | null
  is_dormant: boolean
  is_active: boolean
  is_visible_on_cash_report: boolean
  last_transaction_date: string | null
}

/** Asset buckets of the account list summary. */
export type AssetBucket = 'demand' | 'foreign_currency' | 'savings' | 'fund' | 'trust' | 'insurance' | 'pension'

/** Summary block of the account list. */
export interface BankAccountSummary {
  account_count: number
  total_assets: number
  assets_by_type: Record<AssetBucket, number>
  total_liabilities: number
}

/** A row of `bank_transactions`. */
export interface BankTransactionRow {
  id: string
  company_id: string
  account_id: string
  external_key: string
  transacted_at: string
  direction: 'deposit' | 'withdrawal'
  amount: number
  balance_after: number | null
  summary: string | null
  currency_code: string
  amount_fx: string | null
  account_title_id: string | null
  classified_by: 'manual' | 'rule' | null
  classified_rule_id: string | null
  partner_id: string | null
  memo: string | null
  settlement_status: SettlementStatus
  synced_at: string
}

/** A bank transaction in wire shape. */
export interface BankTransaction {
  id: string
  account_id: string
  bank_code: string
  account_number_tail: string
  account_name: string | null
  transacted_at: string
  direction: 'deposit' | 'withdrawal'
  amount: number
  balance_after: number | null
  summary: string | null
  currency_code: string
  amount_fx: string | null
  account_title_id: string | null
  account_title_name: string | null
  classified_by: 'manual' | 'rule' | null
  classified_rule_id: string | null
  partner_id: string | null
  partner_name: string | null
  memo: string | null
  settlement_status: SettlementStatus
  settled_amount: number
}

/** Filters of the bank transaction list, already validated. */
export interface BankTransactionFilter {
  start: string
  end: string
  direction: 'deposit' | 'withdrawal' | undefined
  accountIds: string[]
  accountTitleIds: string[]
  classification: 'classified' | 'unclassified' | undefined
  partnerId: string | undefined
  search: string | undefined
}

/** One link between a bank transaction and the evidence it settles. */
export interface SettlementLink {
  id: string
  bank_transaction_id: string
  evidence_side: 'sales' | 'purchase'
  evidence_id: string
  amount: number
  created_at: string
}
