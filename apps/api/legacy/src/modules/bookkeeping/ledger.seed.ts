import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../db/query'
import type { SeedContext } from '../../db/seed.types'
import { loadAccountTitleIndex } from './account-titles/account-titles.service'
import { accountNumberDigest, accountNumberTail } from './bank/bank.utils'
import { refreshSettlementStatuses } from './bank/bank.repository'
import type { RuleCondition, RuleScope } from './classification/classification.types'
import { classifyNewRows } from './classification/classification.service'
import { applyScrapedRecords } from './ingestion/ingest-scraped-records'
import type { ScrapedRecord } from './ingestion/ingestion.types'

const COMPANY = 'c-corp'

const PARTNERS: readonly [string, string, string, string, 0 | 1, 0 | 1][] = [
  ['pt-ecopro', '(주)에코프로비엠', '김대표', '1108100011', 1, 0],
  ['pt-office', '오피스디포 코리아', '박대표', '2208100022', 0, 1],
  ['pt-landlord', '강남빌딩관리', '최대표', '3308100033', 0, 1],
]

const RULES: readonly [string, RuleScope, string, RuleCondition[], string, string | null][] = [
  ['rule-bank-ecopro', 'bank', '에코프로 입금', [{ field: 'summary', op: 'contains', values: ['에코프로'] }], 'at-trade-sales-in-partner', 'pt-ecopro'],
  ['rule-bank-rent', 'bank', '임대료', [{ field: 'summary', op: 'contains', values: ['임대료'] }], 'at-sga-rent', 'pt-landlord'],
  ['rule-bank-salary', 'bank', '급여', [{ field: 'summary', op: 'contains', values: ['급여'] }], 'at-sga-salary', null],
  [
    'rule-purchase-card-welfare',
    'purchase',
    '소액 카드 복리후생',
    [
      { field: 'source', op: 'in', values: ['card'] },
      { field: 'supply_amount', op: 'lte', max: 500_000 },
    ],
    'at-sga-welfare',
    null,
  ],
  ['rule-sales-card', 'sales', '카드 매출', [{ field: 'source', op: 'in', values: ['card'] }], 'at-sales', null],
]

const ACCOUNTS: readonly [string, string, string, string, '01' | '41', number][] = [
  ['ba-main', '004', '123-456-789012', '운영자금', '01', 71_450_000],
  ['ba-sub', '088', '110-222-333444', '급여통장', '01', 2_000_000],
  ['ba-loan', '003', '555-66-777888', '운전자금 대출', '41', 100_000_000],
]

const TRANSACTIONS: readonly [string, string, string, number, number, string][] = [
  ['ba-main', 'demo-main-1006', '2026-10-06T10:00:00+09:00', 33_000_000, 73_000_000, '에코프로비엠'],
  ['ba-main', 'demo-main-1010', '2026-10-10T11:00:00+09:00', -11_000_000, 62_000_000, '오피스디포'],
  ['ba-main', 'demo-main-1015', '2026-10-15T09:00:00+09:00', -2_200_000, 59_800_000, '강남빌딩 임대료'],
  ['ba-main', 'demo-main-1021', '2026-10-21T00:10:00+09:00', 30_000, 59_830_000, '이자'],
  ['ba-main', 'demo-main-1028', '2026-10-28T14:00:00+09:00', 9_900_000, 69_730_000, 'KB카드 정산'],
  ['ba-main', 'demo-main-1031a', '2026-10-31T10:00:00+09:00', 2_000_000, 71_730_000, '에코프로비엠 선급'],
  ['ba-main', 'demo-main-1031b', '2026-10-31T15:00:00+09:00', -300_000, 71_430_000, '통신비 자동이체'],
  ['ba-sub', 'demo-sub-1025', '2026-10-25T09:00:00+09:00', -8_000_000, 2_000_000, '10월 급여'],
]

/**
 * Inserts demo partners, bank accounts, bank transactions, rules and classifications for `c-corp`.
 *
 * Only classification columns of the shared evidence rows change, so their
 * amounts and deductibility (and therefore the estimated VAT) stay as seeded.
 * October 2026 then reads 매출 44,000,000, 매출원가 10,000,000, 판관비
 * 11,000,000, 영업외수익 30,000 and 순이익 23,030,000 on the supply basis.
 */
export function seedLedgerDemo(db: DatabaseSync, context: SeedContext): void {
  const { now, cipher } = context
  for (const [id, name, representative, businessNumber, isSales, isPurchase] of PARTNERS) {
    execute(
      db,
      `INSERT INTO partners (id, company_id, partner_type, business_entity_type, name, representative_name, business_number, business_status, is_sales, is_purchase, created_at, updated_at)
       VALUES (?, ?, 'business', 'corporation', ?, ?, ?, 'registered', ?, ?, ?, ?)`,
      [id, COMPANY, name, representative, businessNumber, isSales, isPurchase, now, now],
    )
  }
  RULES.forEach(([id, scope, name, conditions, accountTitleId, partnerId], index) => {
    execute(
      db,
      `INSERT INTO classification_rules (id, company_id, scope, source, name, conditions, result_account_title_id, result_partner_id, priority, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [id, COMPANY, scope, name, JSON.stringify(conditions), accountTitleId, partnerId, index + 1, now, now],
    )
  })

  execute(
    db,
    `UPDATE sales_evidence SET account_title_id = 'at-sales', classified_by = 'manual', partner_id = 'pt-ecopro',
       counterparty_name = '(주)에코프로비엠', counterparty_business_number = '1108100011', item_summary = '2차전지 소재 외 2건', written_on = '2026-10-05'
     WHERE id = 's-1'`,
  )
  execute(db, "UPDATE sales_evidence SET account_title_id = 'at-sales', classified_by = 'manual' WHERE id = 's-4'")
  execute(
    db,
    `UPDATE purchase_evidence SET account_title_id = 'at-cogs-goods', classified_by = 'manual', partner_id = 'pt-office',
       counterparty_name = '오피스디포 코리아', counterparty_business_number = '2208100022'
     WHERE id = 'p-1'`,
  )
  classifyNewRows(db, COMPANY, 'sales', ['s-2', 's-3'])
  classifyNewRows(db, COMPANY, 'purchase', ['p-2', 'p-3'])

  for (const [id, bankCode, accountNumber, name, type, balance] of ACCOUNTS) {
    execute(
      db,
      `INSERT INTO bank_accounts (id, company_id, bank_code, account_number_enc, account_number_digest, account_number_tail, account_name, account_type, balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, COMPANY, bankCode, cipher.encrypt(accountNumber), accountNumberDigest(accountNumber), accountNumberTail(accountNumber), name, type, balance, now, now],
    )
  }
  const numberOf = new Map(ACCOUNTS.map(([id, bankCode, accountNumber]) => [id, { bank_code: bankCode, account_number: accountNumber }]))
  const records: ScrapedRecord[] = [
    { kind: 'bank_balance', ...account(numberOf, 'ba-main'), date: '2026-09-30', closing_balance: 40_000_000 },
    { kind: 'bank_balance', ...account(numberOf, 'ba-sub'), date: '2026-09-30', closing_balance: 10_000_000 },
    ...TRANSACTIONS.map(
      ([accountId, externalKey, at, amount, balanceAfter, summary]): ScrapedRecord => ({
        kind: 'bank_transaction',
        ...account(numberOf, accountId),
        external_key: externalKey,
        transacted_at: at,
        amount,
        balance_after: balanceAfter,
        summary,
      }),
    ),
    { kind: 'bank_balance', ...account(numberOf, 'ba-main'), date: '2026-10-31', closing_balance: 71_450_000 },
  ]
  applyScrapedRecords(db, COMPANY, records, { now, cipher })

  const office = transactionId(db, 'demo-main-1010')
  execute(db, "UPDATE bank_transactions SET account_title_id = 'at-trade-purchase-out', classified_by = 'manual', partner_id = 'pt-office' WHERE id = ?", [office])
  execute(db, "UPDATE bank_transactions SET account_title_id = 'at-noi-interest', classified_by = 'manual' WHERE id = ?", [transactionId(db, 'demo-main-1021')])
  execute(
    db,
    `INSERT INTO settlement_links (id, company_id, bank_transaction_id, evidence_side, evidence_id, amount, created_at)
     VALUES ('sl-ecopro-1006', ?, ?, 'sales', 's-1', 33000000, ?)`,
    [COMPANY, transactionId(db, 'demo-main-1006'), now],
  )
  refreshSettlementStatuses(db, COMPANY, loadAccountTitleIndex(db, COMPANY))
}

function account(numbers: ReadonlyMap<string, { bank_code: string; account_number: string }>, id: string): { bank_code: string; account_number: string } {
  const found = numbers.get(id)
  if (found === undefined) throw new Error(`Unknown demo account ${id}.`)
  return found
}

function transactionId(db: DatabaseSync, externalKey: string): string {
  const row = queryOne<{ id: string }>(db, 'SELECT id FROM bank_transactions WHERE company_id = ? AND external_key = ?', [COMPANY, externalKey])
  if (row === undefined) throw new Error(`Missing demo transaction ${externalKey}.`)
  return row.id
}
