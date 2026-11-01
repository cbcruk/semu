import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { placeholders, queryAll } from '../../../db/query'
import { addDays, daysBetween, fromParts, toParts } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { CompanyRow } from '../../companies/companies.types'
import { estimateVat } from '../../estimated-vat/estimated-vat.service'
import type { SalesEvidenceRow } from '../../estimated-vat/estimated-vat.types'
import { dedupeSales, INCLUDED_SALES_SOURCES } from '../../estimated-vat/estimated-vat.utils'
import { loadAccountTitleIndex } from '../account-titles/account-titles.service'
import type { AccountTitleInfo } from '../account-titles/account-titles.types'
import { closingBalanceOn } from '../bank/bank.repository'
import type { BankAccountRow, BankTransactionRow } from '../bank/bank.types'
import { CASH_ACCOUNT_TYPES } from '../bank/bank.utils'
import type { EvidenceRow } from '../evidence/evidence.types'
import { evidenceAmounts } from '../evidence/evidence.utils'
import { loadBookkeepingPolicy } from '../settings/bookkeeping-settings'
import type {
  CashDaily,
  CashFlowFigures,
  CashPeriodBucket,
  RealtimeProfitLoss,
  ReportUnit,
  SalesPurchaseBucket,
  SalesPurchaseStatus,
} from './realtime-reports.types'
import {
  accumulateFigures,
  addToLine,
  bucketIndexOf,
  bucketsOf,
  cashPeriodRange,
  emptyFigures,
  finalizeFigures,
  isIncomeLine,
  previousYearOf,
  salesPurchaseRange,
} from './realtime-reports.utils'

const UNCLASSIFIED_DEPOSIT = '미분류 입금'
const UNCLASSIFIED_WITHDRAWAL = '미분류 출금'

/**
 * Builds the realtime profit and loss of a year from classified evidence and bank transactions.
 *
 * - Only classified rows count; accounts whose `pl_category` is `none`
 *   (거래대금, 자산·부채) are pass-through and stay out, so a sale and the
 *   deposit that settles it are not counted twice.
 * - Evidence counts at its supply amount (or total, per policy) on its 작성일자.
 * - Classified bank transactions count only when the policy includes them;
 *   they carry costs that have no evidence, such as salaries, rent and interest.
 */
export function realtimeProfitLoss(deps: ServiceDeps, companyId: string, year: number, cumulative: boolean): RealtimeProfitLoss {
  const policy = loadBookkeepingPolicy(deps.db, companyId)
  const titles = loadAccountTitleIndex(deps.db, companyId)
  const months = Array.from({ length: 12 }, () => emptyFigures())
  const yearText = String(year)
  const unclassified = { sales: 0, purchase: 0, bank: 0 }
  const add = (month: number, accountTitleId: string | null, amount: number, inflow: boolean): void => {
    const info = accountTitleId === null ? undefined : titles.get(accountTitleId)
    const figures = months[month - 1]
    if (info === undefined || info.pl_category === 'none' || figures === undefined) return
    const line = info.pl_category
    addToLine(figures, line, info.report_name, isIncomeLine(line) === inflow ? amount : -amount)
  }
  for (const side of ['sales', 'purchase'] as const) {
    const rows = queryAll<EvidenceRow>(
      deps.db,
      `SELECT * FROM ${side}_evidence WHERE company_id = ? AND substr(COALESCE(written_on, issued_on), 1, 4) = ?`,
      [companyId, yearText],
    )
    for (const row of rows) {
      if (row.account_title_id === null) {
        unclassified[side]++
        continue
      }
      const amounts = evidenceAmounts(row)
      const month = Number((row.written_on ?? row.issued_on).slice(5, 7))
      add(month, row.account_title_id, policy.realtimePlBasis === 'supply' ? amounts.supply : amounts.total, side === 'sales')
    }
  }
  const bankRows = queryAll<Pick<BankTransactionRow, 'transacted_at' | 'amount' | 'account_title_id'>>(
    deps.db,
    'SELECT transacted_at, amount, account_title_id FROM bank_transactions WHERE company_id = ? AND substr(transacted_at, 1, 4) = ?',
    [companyId, yearText],
  )
  for (const row of bankRows) {
    if (row.account_title_id === null) {
      unclassified.bank++
      continue
    }
    if (policy.realtimePlIncludeBank) add(Number(row.transacted_at.slice(5, 7)), row.account_title_id, row.amount, true)
  }
  const total = emptyFigures()
  for (const figures of months) accumulateFigures(total, figures)
  const running = emptyFigures()
  const output = months.map((figures, index) => {
    if (!cumulative) return { month: index + 1, ...finalizeFigures(figures) }
    accumulateFigures(running, figures)
    return { month: index + 1, ...finalizeFigures(structuredClone(running)) }
  })
  return {
    year,
    cumulative,
    basis: policy.realtimePlBasis,
    months: output,
    total: finalizeFigures(total),
    unclassified_count: unclassified,
    updated_at: deps.clock.now(),
  }
}

/**
 * Builds 매출·매입 현황: sales and purchase totals per bucket regardless of classification.
 *
 * Sales use the VAT-inclusive total once per `dedupe_group`. With the default
 * `all` source policy, PG and cash receipt duplicates are kept, as the screen
 * notice says; `vat_included` restricts sales to the estimated VAT sources.
 */
export function salesPurchaseStatus(
  deps: ServiceDeps,
  companyId: string,
  unit: ReportUnit,
  preset: string,
  custom: { start?: PlainDate | undefined; end?: PlainDate | undefined },
): SalesPurchaseStatus {
  const policy = loadBookkeepingPolicy(deps.db, companyId)
  const range = salesPurchaseRange(unit, preset, deps.clock.today(), custom)
  const buckets: SalesPurchaseBucket[] = bucketsOf(unit, range.start, range.end).map((bucket) => ({
    ...bucket,
    sales: 0,
    purchase: 0,
    profit: 0,
    prev_year_sales: 0,
    sales_by_source: {},
    purchase_by_source: {},
  }))
  const previousBuckets = buckets.map((bucket) => ({ key: bucket.key, start: previousYearOf(bucket.start as PlainDate), end: previousYearOf(bucket.end as PlainDate) }))
  const sales = queryAll<SalesEvidenceRow & { written_on: string | null }>(
    deps.db,
    'SELECT * FROM sales_evidence WHERE company_id = ? AND COALESCE(written_on, issued_on) BETWEEN ? AND ? ORDER BY issued_on, id',
    [companyId, previousBuckets[0]?.start ?? range.start, range.end],
  )
  const included = policy.salesStatusSources === 'all' ? null : new Set<string>(INCLUDED_SALES_SOURCES)
  const kept = new Set(dedupeSales(sales.filter((candidate) => included === null || included.has(candidate.source))))
  for (const row of sales.filter((candidate) => kept.has(candidate))) {
    const date = row.written_on ?? row.issued_on
    const current = buckets[bucketIndexOf(buckets, date)]
    if (current !== undefined) {
      current.sales += row.total_amount
      current.sales_by_source[row.source] = (current.sales_by_source[row.source] ?? 0) + row.total_amount
    }
    const previous = buckets[bucketIndexOf(previousBuckets, date)]
    if (previous !== undefined) previous.prev_year_sales += row.total_amount
  }
  const purchases = queryAll<EvidenceRow>(
    deps.db,
    'SELECT * FROM purchase_evidence WHERE company_id = ? AND COALESCE(written_on, issued_on) BETWEEN ? AND ?',
    [companyId, range.start, range.end],
  )
  for (const row of purchases) {
    const bucket = buckets[bucketIndexOf(buckets, row.written_on ?? row.issued_on)]
    if (bucket === undefined) continue
    const total = evidenceAmounts(row).total
    bucket.purchase += total
    bucket.purchase_by_source[row.source] = (bucket.purchase_by_source[row.source] ?? 0) + total
  }
  const totals = { sales: 0, purchase: 0, profit: 0 }
  for (const bucket of buckets) {
    bucket.profit = bucket.sales - bucket.purchase
    totals.sales += bucket.sales
    totals.purchase += bucket.purchase
    totals.profit += bucket.profit
  }
  const average = (value: number): number => (buckets.length === 0 ? 0 : Math.round(value / buckets.length))
  return {
    unit,
    preset,
    period: range,
    source_policy: policy.salesStatusSources,
    totals,
    averages: { sales: average(totals.sales), purchase: average(totals.purchase), profit: average(totals.profit) },
    buckets,
  }
}

/**
 * Builds 일별 자금 for one date over the demand-deposit and foreign currency accounts shown on cash reports.
 *
 * `other_change = closing − opening − deposit − withdrawal` captures interest
 * postings, missed scrapes and currency revaluation.
 */
export function cashDaily(deps: ServiceDeps, companyId: string, date: PlainDate, groupBy: 'account' | 'category'): CashDaily {
  const accounts = cashAccounts(deps.db, companyId)
  const titles = loadAccountTitleIndex(deps.db, companyId)
  const transactions = cashTransactions(deps.db, companyId, accounts, date, date)
  const perAccount = accounts.map((account) => {
    const rows = transactions.filter((row) => row.account_id === account.id)
    return {
      key: account.id,
      name: account.account_name ?? `${account.bank_code} ${account.account_number_tail}`,
      bank_code: account.bank_code,
      account_number_tail: account.account_number_tail,
      ...figuresOf(deps.db, [account], rows, date, date),
    }
  })
  const figures = figuresOf(deps.db, accounts, transactions, date, date)
  const groups =
    groupBy === 'account'
      ? perAccount
      : (['deposit', 'withdrawal'] as const).flatMap((direction) => {
          const totals = new Map<string, { name: string; amount: number; count: number }>()
          for (const row of transactions.filter((candidate) => candidate.direction === direction)) {
            const info = row.account_title_id === null ? undefined : titles.get(row.account_title_id)
            const key = info?.id ?? 'unclassified'
            const entry = totals.get(key) ?? { name: info?.name ?? (direction === 'deposit' ? UNCLASSIFIED_DEPOSIT : UNCLASSIFIED_WITHDRAWAL), amount: 0, count: 0 }
            entry.amount += row.amount
            entry.count++
            totals.set(key, entry)
          }
          return [...totals.entries()].map(([key, entry]) => ({ direction, key, ...entry }))
        })
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const partners = partnerNames(deps.db, companyId)
  return {
    date,
    group_by: groupBy,
    ...figures,
    change: figures.closing - figures.opening,
    groups,
    transactions: transactions.map((row) => ({
      id: row.id,
      transacted_at: row.transacted_at,
      direction: row.direction,
      account_id: row.account_id,
      bank_code: byId.get(row.account_id)?.bank_code ?? null,
      account_number_tail: byId.get(row.account_id)?.account_number_tail ?? null,
      partner_id: row.partner_id,
      partner_name: row.partner_id === null ? null : (partners.get(row.partner_id) ?? null),
      account_title_id: row.account_title_id,
      account_title_name: row.account_title_id === null ? null : (titles.get(row.account_title_id)?.name ?? null),
      amount: row.amount,
      memo: row.memo,
      summary: row.summary,
    })),
  }
}

/** Builds 기간별 추이: opening, flows by cash category and closing per bucket. */
export function cashPeriod(deps: ServiceDeps, companyId: string, unit: Exclude<ReportUnit, 'day'>, preset: string): { unit: string; preset: string; period: { start: string; end: string }; buckets: CashPeriodBucket[] } {
  const range = cashPeriodRange(preset, deps.clock.today())
  const accounts = cashAccounts(deps.db, companyId)
  const titles = loadAccountTitleIndex(deps.db, companyId)
  const transactions = cashTransactions(deps.db, companyId, accounts, range.start, range.end)
  const buckets = bucketsOf(unit, range.start, range.end).map((bucket) => {
    const rows = transactions.filter((row) => row.transacted_at.slice(0, 10) >= bucket.start && row.transacted_at.slice(0, 10) <= bucket.end)
    return {
      ...bucket,
      ...figuresOf(deps.db, accounts, rows, bucket.start, bucket.end),
      deposit_by_category: byCategory(rows, 'deposit', titles),
      withdrawal_by_category: byCategory(rows, 'withdrawal', titles),
    }
  })
  return { unit, preset, period: range, buckets }
}

/**
 * Builds the three home cards: yesterday's cash, this month's profit and loss, and the estimated VAT.
 *
 * `vat.due_in_days` counts to the 25th of the month after the estimate
 * period, without holiday adjustment; the tax calendar has the exact date.
 */
export function homeSummaryCards(deps: ServiceDeps, company: CompanyRow): Record<string, unknown> {
  const today = deps.clock.today()
  const yesterday = addDays(today, -1)
  const cash = cashDaily(deps, company.id, yesterday, 'account')
  const { year, month } = toParts(today)
  const pl = realtimeProfitLoss(deps, company.id, year, false).months[month - 1] ?? finalizeFigures(emptyFigures())
  const vat = estimateVat(deps.db, company, today)
  const periodEnd = toParts(vat.period.end as PlainDate)
  const due = fromParts(periodEnd.year, periodEnd.month + 1, 25)
  return {
    cash: { date: yesterday, deposit: cash.deposit, withdrawal: cash.withdrawal, balance: cash.closing },
    pl: {
      month: today.slice(0, 7),
      revenue: pl.revenue,
      expense: -(pl.cogs + pl.sga + pl.non_op_expense),
      net_income: pl.net_income,
    },
    vat: { period: vat.period, estimated_tax: vat.estimated_tax, is_refund: vat.is_refund, due_date: due, due_in_days: daysBetween(today, due) },
    as_of: deps.clock.now(),
  }
}

function cashAccounts(db: DatabaseSync, companyId: string): BankAccountRow[] {
  return queryAll<BankAccountRow>(
    db,
    `SELECT * FROM bank_accounts WHERE company_id = ? AND is_visible_on_cash_report = 1 AND account_type IN (${placeholders(CASH_ACCOUNT_TYPES.length)})
     ORDER BY bank_code, created_at, id`,
    [companyId, ...CASH_ACCOUNT_TYPES],
  )
}

function cashTransactions(db: DatabaseSync, companyId: string, accounts: readonly BankAccountRow[], start: string, end: string): BankTransactionRow[] {
  if (accounts.length === 0) return []
  return queryAll<BankTransactionRow>(
    db,
    `SELECT * FROM bank_transactions WHERE company_id = ? AND account_id IN (${placeholders(accounts.length)})
       AND substr(transacted_at, 1, 10) BETWEEN ? AND ? ORDER BY transacted_at, id`,
    [companyId, ...accounts.map((account) => account.id), start, end],
  )
}

function figuresOf(db: DatabaseSync, accounts: readonly BankAccountRow[], rows: readonly BankTransactionRow[], start: string, end: string): CashFlowFigures {
  const dayBefore = addDays(start as PlainDate, -1)
  const opening = accounts.reduce((sum, account) => sum + closingBalanceOn(db, account.id, dayBefore), 0)
  const closing = accounts.reduce((sum, account) => sum + closingBalanceOn(db, account.id, end), 0)
  const deposit = rows.reduce((sum, row) => sum + (row.amount > 0 ? row.amount : 0), 0)
  const withdrawal = rows.reduce((sum, row) => sum + (row.amount < 0 ? row.amount : 0), 0)
  return { opening, deposit, withdrawal, other_change: closing - opening - deposit - withdrawal, closing }
}

function byCategory(rows: readonly BankTransactionRow[], direction: 'deposit' | 'withdrawal', titles: ReadonlyMap<string, AccountTitleInfo>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    if (row.direction !== direction) continue
    const info = row.account_title_id === null ? undefined : titles.get(row.account_title_id)
    const label = info === undefined ? (direction === 'deposit' ? UNCLASSIFIED_DEPOSIT : UNCLASSIFIED_WITHDRAWAL) : (info.cash_category ?? info.report_name)
    result[label] = (result[label] ?? 0) + row.amount
  }
  return result
}

function partnerNames(db: DatabaseSync, companyId: string): Map<string, string> {
  return new Map(queryAll<{ id: string; name: string }>(db, 'SELECT id, name FROM partners WHERE company_id = ?', [companyId]).map((row) => [row.id, row.name]))
}
