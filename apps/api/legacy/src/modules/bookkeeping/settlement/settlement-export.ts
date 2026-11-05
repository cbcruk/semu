import type { DatabaseSync } from 'node:sqlite'
import { balanceSheetTable } from './balance-sheet-report'
import { cashFlowYear, partnerBalancesOfYear } from './cash-report'
import { buildCostDetails, loadPlYear } from './profit-loss-report'
import { listBsLines, listCashEntries } from './settlement.repository'
import type { PlNode } from './settlement.types'
import { COST_SECTIONS, PL_SECTIONS, toCsv } from './settlement.utils'

/** Tax report kinds the CSV export serves; labor cost is served by the payroll domain. */
export type ExportKind = 'profit-loss' | 'cost-details' | 'receivable-payable' | 'cash-flow' | 'balance-sheet'

type CsvRow = (string | number | null)[]

const MONTH_HEADERS = Array.from({ length: 12 }, (_, index) => `${index + 1}월`)

/**
 * Renders a tax report of a fiscal year as CSV.
 *
 * Profit and loss rows list every account path with the yearly total and
 * twelve monthly columns; months after the closing are blank.
 */
export function exportSettlementCsv(db: DatabaseSync, companyId: string, kind: ExportKind, year: number): string {
  switch (kind) {
    case 'profit-loss':
      return toCsv(plRows(db, companyId, year, PL_SECTIONS))
    case 'cost-details': {
      const details = buildCostDetails(db, companyId, year)
      return toCsv([...plRows(db, companyId, year, COST_SECTIONS), ['비용 총합', '', details.cost_total]])
    }
    case 'receivable-payable': {
      const header: CsvRow = ['구분', '거래처코드', '거래처명', '내용', '전년도 이월 잔액', '증가액', '감소액', '잔액']
      const rows = (['receivable', 'payable'] as const).flatMap((side) =>
        partnerBalancesOfYear(db, companyId, side, year).map((partner): CsvRow => [
          side === 'receivable' ? '미수금' : '미지급금',
          partner.partner_id,
          partner.partner_name,
          partner.summary,
          partner.previous_month_roll_over_balance,
          partner.increase_amount,
          partner.decrease_amount,
          partner.balance,
        ]),
      )
      return toCsv([header, ...rows])
    }
    case 'cash-flow': {
      const monthly = cashFlowYear(db, companyId, year).map((row): CsvRow => [`${row.month}월`, row.inflow, row.effluent, row.unique_inflow, row.funds_held])
      const entries = listCashEntries(db, companyId, year).map((entry): CsvRow => [entry.date, entry.cash_account, entry.summary, entry.inflow, entry.outflow, entry.balance])
      return toCsv([['월', '입금', '출금', '순유입', '보유자금'], ...monthly, [], ['일자', '계정', '적요', '입금', '출금', '잔액'], ...entries])
    }
    case 'balance-sheet': {
      const months = balanceSheetTable(db, companyId, year).map((month) => month.target_date)
      const lines = listBsLines(db, companyId, year)
      const subjects = [...new Map(lines.map((line) => [line.subject, line])).values()].sort((a, b) => a.sort_order - b.sort_order)
      const rows = subjects.map((subject): CsvRow => [
        subject.parent_subject ?? '',
        subject.subject,
        ...months.map((month) => lines.find((line) => line.target_month === month && line.subject === subject.subject)?.amount ?? null),
      ])
      return toCsv([['상위 과목', '과목', ...months], ...rows])
    }
  }
}

function plRows(db: DatabaseSync, companyId: string, year: number, sections: readonly (typeof PL_SECTIONS)[number][]): CsvRow[] {
  const loaded = loadPlYear(db, companyId, year)
  const rows: CsvRow[] = [['구분', '계정', '당기', ...MONTH_HEADERS]]
  if (loaded === null) return rows
  const monthNodes = (section: (typeof PL_SECTIONS)[number]): (PlNode | undefined)[] =>
    Array.from({ length: 12 }, (_, index) => loaded.months[String(index + 1)]?.[section])
  for (const section of sections) {
    const visit = (nodes: (PlNode | undefined)[], path: string[]): void => {
      const values = nodes.map((node) => node?.value ?? null)
      rows.push([section, path.join(' > '), values.reduce<number>((sum, value) => sum + (value ?? 0), 0), ...values])
      const names: string[] = []
      for (const node of nodes) for (const name of Object.keys(node?.sub_list ?? {})) if (!names.includes(name)) names.push(name)
      for (const name of names) visit(nodes.map((node) => node?.sub_list[name]), [...path, name])
    }
    visit(monthNodes(section), [])
  }
  return rows
}
