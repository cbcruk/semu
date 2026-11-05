import type { PlainDate } from '../../../lib/plain-date.types'

/** Part of a settlement snapshot that an agency upload replaces as a whole. */
export type SettlementScope = 'pl' | 'bs' | 'cash' | 'ar_ap'

/** Profit and loss section stored in `settlement_pl_lines`, in the fixed wire order. */
export type PlSection = '매출액' | '매출원가' | '매출총이익' | '판매비와관리비' | '영업이익' | '영업외수익' | '영업외비용' | '법인세등' | '당기순이익'

/** Sections an upload supplies; the others are derived on the server. */
export type PlBaseSection = '매출액' | '매출원가' | '판매비와관리비' | '영업외수익' | '영업외비용' | '법인세등'

/** Cash-equivalent ledger account of the cash flow report. */
export type CashAccount = '현금' | '당좌예금' | '보통예금' | '제예금'

/** Side of the receivable and payable report. */
export type PartnerBalanceKind = 'receivable' | 'payable'

/** One uploaded profit and loss line; `path` is `''` for the section total or `a/b` for nested accounts. */
export interface PlLineInput {
  month: number
  section: PlBaseSection
  path: string
  amount: number
}

/** One uploaded balance sheet line of a month. */
export interface BsLineInput {
  target_month: PlainDate
  subject: string
  parent_subject: string | null
  sort_order: number
  amount: number
}

/** One uploaded month of a cash-equivalent account. */
export interface CashLedgerInput {
  month: number
  cash_account: CashAccount
  inflow: number
  outflow: number
  closing_balance: number
}

/** One uploaded ledger entry of a cash-equivalent account. */
export interface CashEntryInput {
  date: PlainDate
  cash_account: CashAccount
  summary: string | null
  inflow: number
  outflow: number
  balance: number
}

/** One uploaded month of a partner's receivable or payable balance. */
export interface PartnerBalanceInput {
  kind: PartnerBalanceKind
  month: number
  erp_partner_code: string
  partner_name: string
  summary: string | null
  entry_count: number
  rollover_balance: number
  increase_amount: number
  decrease_amount: number
  balance: number
}

/** One uploaded ledger entry of a partner; `transaction_amount` is negative for decreases. */
export interface PartnerEntryInput {
  kind: PartnerBalanceKind
  erp_partner_code: string
  date: PlainDate
  summary: string | null
  transaction_amount: number
  balance: number
}

/** Normalized upload body for each scope. */
export type SnapshotUpload =
  | { scope: 'pl'; closed_through: PlainDate; lines: PlLineInput[] }
  | { scope: 'bs'; closed_through: PlainDate; rows: BsLineInput[] }
  | { scope: 'cash'; closed_through: PlainDate; ledger: CashLedgerInput[]; entries: CashEntryInput[] }
  | { scope: 'ar_ap'; closed_through: PlainDate; balances: PartnerBalanceInput[]; entries: PartnerEntryInput[] }

/** A row of `settlement_closings`. */
export interface SettlementClosingRow {
  company_id: string
  fiscal_year: number
  scope: SettlementScope
  closed_through: PlainDate
  updated_at: string
  updated_by: string
}

/** A row of `settlement_pl_lines`. */
export interface PlLineRow {
  year: number
  month: number
  section: PlSection
  path: string
  amount: number
}

/** A row of `settlement_bs_lines`. */
export interface BsLineRow {
  target_month: string
  subject: string
  parent_subject: string | null
  sort_order: number
  amount: number
}

/** A row of `settlement_cash_ledger`. */
export interface CashLedgerRow {
  year: number
  month: number
  cash_account: CashAccount
  inflow: number
  outflow: number
  closing_balance: number
}

/** A row of `settlement_cash_entries`. */
export interface CashEntryRow {
  seq: number
  date: string
  cash_account: string
  summary: string | null
  inflow: number
  outflow: number
  balance: number
}

/** A row of `settlement_partner_balances`. */
export interface PartnerBalanceRow {
  kind: PartnerBalanceKind
  year: number
  month: number
  erp_partner_code: string
  partner_name: string
  summary: string | null
  entry_count: number
  rollover_balance: number
  increase_amount: number
  decrease_amount: number
  balance: number
}

/** A row of `settlement_partner_entries`. */
export interface PartnerEntryRow {
  erp_partner_code: string
  seq: number
  date: string
  summary: string | null
  transaction_amount: number
  balance: number
}

/** A profit and loss node as the client reads it; `sub_list` keys are Korean account names. */
export interface PlNode {
  value: number
  sub_list: Record<string, PlNode>
}

/** Body of `GET /report/profit-loss/:year` and its month-range variant. */
export interface ProfitLossResponse {
  content: {
    has_data: boolean
    month_range: string[]
    data: Record<string, Record<string, Record<PlSection, PlNode>>>
    updated: Record<string, string>
  }
}

/** Monthly figures of the cost analysis. */
export interface CostMonth {
  month: number
  revenue: number
  cogs: number
  sga: number
  non_op_expense: number
  income_tax: number
  cost_total: number
  cogs_ratio: string | null
  sga_ratio: string | null
}

/** One account of a cost section with its yearly total and monthly amounts. */
export interface CostAccountLine {
  name: string
  total: number
  months: Record<string, number>
}

/** Body of the server-computed cost analysis. */
export interface CostDetailsResponse {
  year: number
  has_data: boolean
  months: CostMonth[]
  totals: Omit<CostMonth, 'month'>
  sga_top: CostAccountLine[]
  sga_details: CostAccountLine[]
  welfare_usage: { labor_cost: number; welfare: number; rate: string | null; baseline: string }
  sections: { section: PlSection; total: number; months: Record<string, number>; accounts: CostAccountLine[] }[]
  cost_total: number
}

/** One month of the yearly cash flow response; amounts are strings on the wire. */
export interface CashFlowMonth {
  month: number
  inflow: string
  effluent: string
  unique_inflow: string
  funds_held: string
}

/** One month of the yearly receivable or payable response; amounts are strings on the wire. */
export interface PartnerBalanceMonth {
  month: number
  increase_amount: string
  decrease_amount: string
  balance: string
  previous_month_roll_over_balance: string
}

/** One partner of the yearly by-partner list; amounts are strings on the wire. */
export interface PartnerBalanceSummary {
  partner_id: number | string
  partner_name: string
  summary: string | null
  count: number
  balance: string
  increase_amount: string
  decrease_amount: string
  previous_month_roll_over_balance: string
}

/** A page-number style DRF envelope, used where the client sends `?page=`. */
export interface NumberedPage<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

/** One balance sheet subject of a month with its children. */
export interface BsTableItem {
  subject: string
  amount: number
  items: { subject: string; amount: number }[]
}

/** One financial ratio series of the balance sheet chart. */
export interface BsChartSeries {
  name: string
  ratio: string | null
  items: { target_date: string; ratio: string | null }[]
}
