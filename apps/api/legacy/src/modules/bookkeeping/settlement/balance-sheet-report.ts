import type { DatabaseSync } from 'node:sqlite'
import { cumulativeSection } from './profit-loss-report'
import { listBsLines, listClosings, listPlLines } from './settlement.repository'
import type { BsChartSeries, BsLineRow, BsTableItem } from './settlement.types'
import { BS_CHART_NAMES, BS_SUBJECT_ORDER, formatRatio } from './settlement.utils'

/** Body of `GET /report/balance-sheet/summary`. */
export interface BalanceSheetSummary {
  has_data: boolean
  closing_date: string | null
  assets: number
  liabilities: number
  equity: number
  closing_list: number[]
}

/** Summarizes the latest closed month of the latest fiscal year with a balance sheet snapshot. */
export function balanceSheetSummary(db: DatabaseSync, companyId: string): BalanceSheetSummary {
  const closings = listClosings(db, companyId, 'bs')
  const closingList = closings.map((closing) => closing.fiscal_year)
  const latest = closings.at(-1)
  if (latest === undefined) return { has_data: false, closing_date: null, assets: 0, liabilities: 0, equity: 0, closing_list: [] }
  const lines = listBsLines(db, companyId, latest.fiscal_year)
  const month = lastMonth(lines)
  const amount = (subject: string): number => amountOf(lines, month, subject)
  return {
    has_data: month !== null,
    closing_date: latest.closed_through,
    assets: amount('자산'),
    liabilities: amount('부채'),
    equity: amount('자본'),
    closing_list: closingList,
  }
}

/**
 * Computes the eight financial ratios for each month of a fiscal year.
 *
 * Percent ratios use ×100; turnover ratios are plain multiples. Revenue and
 * net income are cumulative from January through the month, read from the
 * profit and loss snapshot. A zero denominator yields `null`. The series
 * `ratio` is its last month's value.
 */
export function balanceSheetChart(db: DatabaseSync, companyId: string, year: number): BsChartSeries[] {
  const lines = listBsLines(db, companyId, year)
  const pl = listPlLines(db, companyId, year)
  const months = [...new Set(lines.map((line) => line.target_month))].sort()
  const ratiosOf = (month: string): Record<(typeof BS_CHART_NAMES)[number], string | null> => {
    const amount = (subject: string): number => amountOf(lines, month, subject)
    const through = Number(month.slice(5, 7))
    const revenue = cumulativeSection(pl, '매출액', through)
    const netIncome = cumulativeSection(pl, '당기순이익', through)
    return {
      자기자본비율: formatRatio(amount('자본'), amount('자산')),
      부채비율: formatRatio(amount('부채'), amount('자본')),
      유동비율: formatRatio(amount('Ⅰ.유동자산'), amount('Ⅰ.유동부채')),
      총자본순이익률: formatRatio(netIncome, amount('자산')),
      자기자본순이익률: formatRatio(netIncome, amount('자본')),
      총자산회전율: formatRatio(revenue, amount('자산'), 1),
      재고자산회전율: formatRatio(revenue, amount('재고자산'), 1),
      매출채권회전율: formatRatio(revenue, amount('매출채권'), 1),
    }
  }
  const perMonth = months.map((month) => ({ month, ratios: ratiosOf(month) }))
  return BS_CHART_NAMES.map((name) => {
    const items = perMonth.map(({ month, ratios }) => ({ target_date: month, ratio: ratios[name] }))
    return { name, ratio: items.at(-1)?.ratio ?? null, items }
  })
}

/** Builds the monthly balance sheet table with the fixed subject order and their direct children. */
export function balanceSheetTable(db: DatabaseSync, companyId: string, year: number): { target_date: string; items: BsTableItem[] }[] {
  const lines = listBsLines(db, companyId, year)
  const months = [...new Set(lines.map((line) => line.target_month))].sort()
  return months.map((month) => ({
    target_date: month,
    items: BS_SUBJECT_ORDER.map(({ subject, children }) => {
      const extra = lines
        .filter((line) => line.target_month === month && line.parent_subject === subject && !children.includes(line.subject))
        .map((line) => line.subject)
      return {
        subject,
        amount: amountOf(lines, month, subject),
        items: [...children, ...extra].map((child) => ({ subject: child, amount: amountOf(lines, month, child) })),
      }
    }),
  }))
}

function lastMonth(lines: readonly BsLineRow[]): string | null {
  return lines.reduce<string | null>((latest, line) => (latest === null || line.target_month > latest ? line.target_month : latest), null)
}

function amountOf(lines: readonly BsLineRow[], month: string | null, subject: string): number {
  return lines.find((line) => line.target_month === month && line.subject === subject)?.amount ?? 0
}
