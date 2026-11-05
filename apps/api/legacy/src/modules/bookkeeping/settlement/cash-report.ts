import type { DatabaseSync } from 'node:sqlite'
import { notFound } from '../../../lib/domain-error'
import { listCashLedger, listClosings, listPartnerBalances, listPartnerEntries } from './settlement.repository'
import type { CashFlowMonth, PartnerBalanceKind, PartnerBalanceMonth, PartnerBalanceRow, PartnerBalanceSummary } from './settlement.types'

/** Body of `GET /report/cash-flow/summary`. */
export interface CashFlowSummary {
  has_data: boolean
  closing_date: string | null
  funds_held: number
  closing_list: number[]
}

/** Body of `GET /accounting/settlement/receivable-payable/summary`. */
export interface ReceivablePayableSummary {
  has_data: boolean
  receivable_balance: number
  payable_balance: number
  latest_settlement_date: string | null
  closing_list: number[]
}

/** Body of a partner's receivable or payable ledger. */
export interface PartnerLedger {
  name: string
  year: number
  balance: string
  rollover_balance: string
  item: { date: string; summary: string | null; transaction_amount: string; balance: string }[]
}

/**
 * Returns the funds held at the latest closed month of the latest cash snapshot.
 *
 * Funds held is the sum of closing balances of 현금, 당좌예금, 보통예금 and
 * 제예금. The spec also adds assets maturing within the year; that part is
 * left out until its BS accounts are confirmed.
 */
export function cashFlowSummary(db: DatabaseSync, companyId: string): CashFlowSummary {
  const closings = listClosings(db, companyId, 'cash')
  const latest = closings.at(-1)
  if (latest === undefined) return { has_data: false, closing_date: null, funds_held: 0, closing_list: [] }
  const ledger = listCashLedger(db, companyId, latest.fiscal_year)
  const month = Math.max(0, ...ledger.map((row) => row.month))
  return {
    has_data: ledger.length > 0,
    closing_date: latest.closed_through,
    funds_held: ledger.filter((row) => row.month === month).reduce((sum, row) => sum + row.closing_balance, 0),
    closing_list: closings.map((closing) => closing.fiscal_year),
  }
}

/** Sums the cash-equivalent accounts per month; `unique_inflow` is the net inflow and amounts are strings. */
export function cashFlowYear(db: DatabaseSync, companyId: string, year: number): CashFlowMonth[] {
  const ledger = listCashLedger(db, companyId, year)
  const months = [...new Set(ledger.map((row) => row.month))].sort((a, b) => a - b)
  return months.map((month) => {
    const rows = ledger.filter((row) => row.month === month)
    const inflow = rows.reduce((sum, row) => sum + row.inflow, 0)
    const outflow = rows.reduce((sum, row) => sum + row.outflow, 0)
    const held = rows.reduce((sum, row) => sum + row.closing_balance, 0)
    return { month, inflow: String(inflow), effluent: String(outflow), unique_inflow: String(inflow - outflow), funds_held: String(held) }
  })
}

/** Returns receivable and payable balances at the last closed month of the latest snapshot. */
export function receivablePayableSummary(db: DatabaseSync, companyId: string): ReceivablePayableSummary {
  const closings = listClosings(db, companyId, 'ar_ap')
  const latest = closings.at(-1)
  if (latest === undefined) return { has_data: false, receivable_balance: 0, payable_balance: 0, latest_settlement_date: null, closing_list: [] }
  const balanceAtEnd = (kind: PartnerBalanceKind): number => {
    const rows = listPartnerBalances(db, companyId, kind, latest.fiscal_year)
    const month = Math.max(0, ...rows.map((row) => row.month))
    return rows.filter((row) => row.month === month).reduce((sum, row) => sum + row.balance, 0)
  }
  return {
    has_data: true,
    receivable_balance: balanceAtEnd('receivable'),
    payable_balance: balanceAtEnd('payable'),
    latest_settlement_date: latest.closed_through,
    closing_list: closings.map((closing) => closing.fiscal_year),
  }
}

/** Aggregates every partner per month for both kinds; amounts are strings. */
export function receivablePayableYear(db: DatabaseSync, companyId: string, year: number): { monthly_receivable: PartnerBalanceMonth[]; monthly_payable: PartnerBalanceMonth[] } {
  return {
    monthly_receivable: monthlyOf(listPartnerBalances(db, companyId, 'receivable', year)),
    monthly_payable: monthlyOf(listPartnerBalances(db, companyId, 'payable', year)),
  }
}

/**
 * Summarizes each partner over a fiscal year.
 *
 * `previous_month_roll_over_balance` is the balance carried in from the prior
 * year, increases and decreases are yearly totals and `balance` is the last
 * month's balance. `partner_id` is the ERP partner code, as a number when it
 * is all digits.
 */
export function partnerBalancesOfYear(db: DatabaseSync, companyId: string, kind: PartnerBalanceKind, year: number): PartnerBalanceSummary[] {
  return groupByPartner(listPartnerBalances(db, companyId, kind, year)).map((rows) => {
    const first = rows[0] as PartnerBalanceRow
    const last = rows.at(-1) as PartnerBalanceRow
    return {
      partner_id: partnerIdOf(first.erp_partner_code),
      partner_name: last.partner_name,
      summary: last.summary,
      count: rows.reduce((sum, row) => sum + row.entry_count, 0),
      balance: String(last.balance),
      increase_amount: String(rows.reduce((sum, row) => sum + row.increase_amount, 0)),
      decrease_amount: String(rows.reduce((sum, row) => sum + row.decrease_amount, 0)),
      previous_month_roll_over_balance: String(first.rollover_balance),
    }
  })
}

/**
 * Returns one partner's ledger entries of a fiscal year with running balances.
 *
 * @throws {DomainError} `NOT_FOUND` when the partner has no balance in that year.
 */
export function partnerLedger(db: DatabaseSync, companyId: string, kind: PartnerBalanceKind, year: number, partnerId: string): PartnerLedger {
  const rows = groupByPartner(listPartnerBalances(db, companyId, kind, year)).find(
    (group) => String(partnerIdOf((group[0] as PartnerBalanceRow).erp_partner_code)) === partnerId || (group[0] as PartnerBalanceRow).erp_partner_code === partnerId,
  )
  if (rows === undefined) throw notFound('Partner')
  const first = rows[0] as PartnerBalanceRow
  const last = rows.at(-1) as PartnerBalanceRow
  return {
    name: last.partner_name,
    year,
    balance: String(last.balance),
    rollover_balance: String(first.rollover_balance),
    item: listPartnerEntries(db, companyId, kind, year, first.erp_partner_code).map((entry) => ({
      date: entry.date,
      summary: entry.summary,
      transaction_amount: String(entry.transaction_amount),
      balance: String(entry.balance),
    })),
  }
}

function monthlyOf(rows: readonly PartnerBalanceRow[]): PartnerBalanceMonth[] {
  const months = [...new Set(rows.map((row) => row.month))].sort((a, b) => a - b)
  return months.map((month) => {
    const ofMonth = rows.filter((row) => row.month === month)
    const sum = (pick: (row: PartnerBalanceRow) => number): string => String(ofMonth.reduce((total, row) => total + pick(row), 0))
    return {
      month,
      increase_amount: sum((row) => row.increase_amount),
      decrease_amount: sum((row) => row.decrease_amount),
      balance: sum((row) => row.balance),
      previous_month_roll_over_balance: sum((row) => row.rollover_balance),
    }
  })
}

function groupByPartner(rows: readonly PartnerBalanceRow[]): PartnerBalanceRow[][] {
  const groups = new Map<string, PartnerBalanceRow[]>()
  for (const row of rows) {
    const group = groups.get(row.erp_partner_code) ?? []
    group.push(row)
    groups.set(row.erp_partner_code, group)
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a.month - b.month))
}

function partnerIdOf(code: string): number | string {
  return /^\d+$/.test(code) ? Number(code) : code
}
