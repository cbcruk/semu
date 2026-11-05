import type { PlCategory } from '../account-titles/account-titles.types'

/** Profit and loss categories that appear as report lines. */
export type PlLine = Exclude<PlCategory, 'none'>

/** Profit and loss figures of one month or of the year. */
export interface PlFigures {
  revenue: number
  cogs: number
  gross_profit: number
  sga: number
  operating_profit: number
  non_op_income: number
  non_op_expense: number
  income_tax: number
  net_income: number
  /** Amount per account title name (Korean, emitted verbatim) under each line. */
  breakdown: Record<PlLine, Record<string, number>>
}

/** Realtime profit and loss response of 손익 현황 > 손익. */
export interface RealtimeProfitLoss {
  year: number
  cumulative: boolean
  basis: 'supply' | 'total'
  months: (PlFigures & { month: number })[]
  total: PlFigures
  /** Rows left out because they are not classified yet. */
  unclassified_count: { sales: number; purchase: number; bank: number }
  updated_at: string
}

/** Bucket size of a period report. */
export type ReportUnit = 'day' | 'month' | 'quarter' | 'year'

/** A labelled date range a report sums over. */
export interface Bucket {
  key: string
  start: string
  end: string
}

/** One bucket of 매출·매입 현황. */
export interface SalesPurchaseBucket extends Bucket {
  sales: number
  purchase: number
  profit: number
  prev_year_sales: number
  sales_by_source: Record<string, number>
  purchase_by_source: Record<string, number>
}

/** Response of 손익 현황 > 매출·매입. */
export interface SalesPurchaseStatus {
  unit: ReportUnit
  preset: string
  period: { start: string; end: string }
  source_policy: 'all' | 'vat_included'
  totals: { sales: number; purchase: number; profit: number }
  averages: { sales: number; purchase: number; profit: number }
  buckets: SalesPurchaseBucket[]
}

/** Opening, flows and closing of cash over a range. */
export interface CashFlowFigures {
  opening: number
  deposit: number
  withdrawal: number
  other_change: number
  closing: number
}

/** Response of 자금 현황 > 일별 자금. */
export interface CashDaily extends CashFlowFigures {
  date: string
  group_by: 'account' | 'category'
  change: number
  groups: Record<string, unknown>[]
  transactions: Record<string, unknown>[]
}

/** One bucket of 자금 현황 > 기간별 추이. */
export interface CashPeriodBucket extends Bucket, CashFlowFigures {
  deposit_by_category: Record<string, number>
  withdrawal_by_category: Record<string, number>
}
