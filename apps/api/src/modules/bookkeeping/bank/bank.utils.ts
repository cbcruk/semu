import { createHash } from 'node:crypto'
import type { AccountTitleInfo } from '../account-titles/account-titles.types'
import type { RuleFacts } from '../classification/classification.types'
import type { AssetBucket, BankAccountType, BankTransactionRow, SettlementStatus } from './bank.types'

/** Account group whose bank transactions settle partner evidence (거래대금). */
export const TRADE_GROUP_CODE = 'trade'

/** Most bank accounts a company may register. */
export const MAX_BANK_ACCOUNTS = 20

/** Account types whose balances count toward the cash reports: demand deposits and foreign currency. */
export const CASH_ACCOUNT_TYPES: readonly BankAccountType[] = ['01', '31']

/** Asset bucket of each non-loan account type. */
export const ASSET_BUCKET: Record<Exclude<BankAccountType, '41'>, AssetBucket> = {
  '01': 'demand',
  '31': 'foreign_currency',
  '02': 'savings',
  '21': 'fund',
  '11': 'trust',
  '51': 'insurance',
  '61': 'pension',
}

/** Hashes an account number so the unique key works without storing it in clear text. */
export function accountNumberDigest(accountNumber: string): string {
  return createHash('sha256').update(accountNumber.replace(/\D/g, '')).digest('hex')
}

/** Returns the last six digits shown next to the bank name. */
export function accountNumberTail(accountNumber: string): string {
  return accountNumber.replace(/\D/g, '').slice(-6)
}

/**
 * Decides the 증빙 연결 status of a bank transaction.
 *
 * | condition | status |
 * | --- | --- |
 * | account outside the 거래대금 group, or unclassified | `not_applicable` |
 * | 거래대금 without a partner | `partner_required` |
 * | linked amounts equal the absolute amount | `matched` |
 * | otherwise | `unmatched` |
 */
export function settlementStatusOf(account: AccountTitleInfo | undefined, partnerId: string | null, amount: number, linkedAmount: number): SettlementStatus {
  if (account === undefined || account.group_code !== TRADE_GROUP_CODE) return 'not_applicable'
  if (partnerId === null) return 'partner_required'
  return linkedAmount === Math.abs(amount) ? 'matched' : 'unmatched'
}

/** Gathers the values classification rules look at from a bank transaction. */
export function bankFacts(row: BankTransactionRow): RuleFacts {
  return {
    partner: row.partner_id,
    counterparty: '',
    item: '',
    total_amount: row.amount,
    supply_amount: row.amount,
    vat_amount: 0,
    source: null,
    summary: row.summary ?? '',
    amount: row.amount,
    account: row.account_id,
    direction: row.direction,
  }
}
