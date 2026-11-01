import type { DatabaseSync } from 'node:sqlite'
import { findClosing, listPlLines } from './settlement.repository'
import type { CostAccountLine, CostDetailsResponse, CostMonth, PlLineRow, PlNode, PlSection, ProfitLossResponse } from './settlement.types'
import { COST_SECTIONS, formatRatio, formatWallTime, LABOR_COST_ACCOUNTS, monthKeys, PL_SECTIONS, WELFARE_BASELINE_PERCENT } from './settlement.utils'

interface DraftNode {
  explicit: number | null
  children: Map<string, DraftNode>
}

/** Months of one fiscal year, each holding every section as a {@linkcode PlNode} tree. */
export type PlYear = Record<string, Record<PlSection, PlNode>>

/**
 * Builds the profit and loss statement of a fiscal year from its snapshot.
 *
 * @param includePreviousYear Whether `data` also carries the previous fiscal year, as the month-range variant does.
 */
export function buildProfitLoss(db: DatabaseSync, companyId: string, year: number, includePreviousYear: boolean): ProfitLossResponse {
  const data: ProfitLossResponse['content']['data'] = {}
  const updated: Record<string, string> = {}
  for (const target of includePreviousYear ? [year - 1, year] : [year]) {
    const loaded = loadPlYear(db, companyId, target)
    if (loaded === null) continue
    data[String(target)] = loaded.months
    updated[String(target)] = loaded.updatedAt
  }
  const closedMonth = closedMonthOf(db, companyId, year)
  return {
    content: {
      has_data: data[String(year)] !== undefined,
      month_range: closedMonth === null ? [] : monthKeys(year - 1, year, closedMonth),
      data,
      updated,
    },
  }
}

/** Loads one closed fiscal year as month trees, or `null` when no profit and loss snapshot exists. */
export function loadPlYear(db: DatabaseSync, companyId: string, year: number): { months: PlYear; closedMonth: number; updatedAt: string } | null {
  const closing = findClosing(db, companyId, year, 'pl')
  if (closing === undefined) return null
  const closedMonth = Number(closing.closed_through.slice(5, 7))
  const lines = listPlLines(db, companyId, year)
  const months: PlYear = {}
  for (let month = 1; month <= closedMonth; month++) {
    const ofMonth = lines.filter((line) => line.month === month)
    months[String(month)] = Object.fromEntries(PL_SECTIONS.map((section) => [section, buildSection(ofMonth.filter((line) => line.section === section))])) as Record<
      PlSection,
      PlNode
    >
  }
  return { months, closedMonth, updatedAt: formatWallTime(closing.updated_at) }
}

/**
 * Computes the cost analysis of a fiscal year from its profit and loss snapshot.
 *
 * Cost total is 매출원가 + 판매비와관리비 + 영업외비용 + 법인세등. The welfare
 * usage rate divides 복리후생비 by the 판매비와관리비 accounts listed in
 * {@linkcode LABOR_COST_ACCOUNTS}.
 */
export function buildCostDetails(db: DatabaseSync, companyId: string, year: number): CostDetailsResponse {
  const loaded = loadPlYear(db, companyId, year)
  const months = loaded === null ? [] : Object.keys(loaded.months).map(Number)
  const valueOf = (month: number, section: PlSection): number => loaded?.months[String(month)]?.[section].value ?? 0
  const costMonth = (pick: (section: PlSection) => number): Omit<CostMonth, 'month'> => {
    const revenue = pick('매출액')
    const cogs = pick('매출원가')
    const sga = pick('판매비와관리비')
    const nonOpExpense = pick('영업외비용')
    const incomeTax = pick('법인세등')
    return {
      revenue,
      cogs,
      sga,
      non_op_expense: nonOpExpense,
      income_tax: incomeTax,
      cost_total: cogs + sga + nonOpExpense + incomeTax,
      cogs_ratio: formatRatio(cogs, revenue),
      sga_ratio: formatRatio(sga, revenue),
    }
  }
  const monthly = months.map((month) => ({ month, ...costMonth((section) => valueOf(month, section)) }))
  const totals = costMonth((section) => months.reduce((sum, month) => sum + valueOf(month, section), 0))
  const sections = COST_SECTIONS.map((section) => {
    const accounts = accountLines(months, (month) => loaded?.months[String(month)]?.[section].sub_list ?? {})
    const perMonth = Object.fromEntries(months.map((month) => [String(month), valueOf(month, section)]))
    return { section, total: months.reduce((sum, month) => sum + valueOf(month, section), 0), months: perMonth, accounts }
  })
  const sgaDetails = sections.find((entry) => entry.section === '판매비와관리비')?.accounts ?? []
  const laborCost = sgaDetails.filter((line) => LABOR_COST_ACCOUNTS.includes(line.name)).reduce((sum, line) => sum + line.total, 0)
  const welfare = sgaDetails.find((line) => line.name === '복리후생비')?.total ?? 0
  return {
    year,
    has_data: loaded !== null,
    months: monthly,
    totals,
    sga_top: [...sgaDetails].sort((a, b) => b.total - a.total).slice(0, 5),
    sga_details: sgaDetails,
    welfare_usage: { labor_cost: laborCost, welfare, rate: formatRatio(welfare, laborCost), baseline: WELFARE_BASELINE_PERCENT },
    sections,
    cost_total: totals.cost_total,
  }
}

/** Sums one section's value over months 1 through `throughMonth` of a fiscal year. */
export function cumulativeSection(lines: readonly PlLineRow[], section: PlSection, throughMonth: number): number {
  return lines.filter((line) => line.section === section && line.path === '' && line.month <= throughMonth).reduce((sum, line) => sum + line.amount, 0)
}

function closedMonthOf(db: DatabaseSync, companyId: string, year: number): number | null {
  const closing = findClosing(db, companyId, year, 'pl')
  return closing === undefined ? null : Number(closing.closed_through.slice(5, 7))
}

function accountLines(months: readonly number[], subListOf: (month: number) => Record<string, PlNode>): CostAccountLine[] {
  const names: string[] = []
  for (const month of months) for (const name of Object.keys(subListOf(month))) if (!names.includes(name)) names.push(name)
  return names.map((name) => {
    const perMonth = Object.fromEntries(months.map((month) => [String(month), subListOf(month)[name]?.value ?? 0]))
    return { name, total: Object.values(perMonth).reduce((sum, value) => sum + value, 0), months: perMonth }
  })
}

function buildSection(lines: readonly PlLineRow[]): PlNode {
  const root: DraftNode = { explicit: null, children: new Map() }
  for (const line of lines) {
    let node = root
    if (line.path !== '') {
      for (const name of line.path.split('/')) {
        let child = node.children.get(name)
        if (child === undefined) {
          child = { explicit: null, children: new Map() }
          node.children.set(name, child)
        }
        node = child
      }
    }
    node.explicit = line.amount
  }
  return finish(root)
}

function finish(draft: DraftNode): PlNode {
  const subList: Record<string, PlNode> = {}
  for (const [name, child] of draft.children) subList[name] = finish(child)
  const value = draft.explicit ?? Object.values(subList).reduce((sum, child) => sum + child.value, 0)
  return { value, sub_list: subList }
}
