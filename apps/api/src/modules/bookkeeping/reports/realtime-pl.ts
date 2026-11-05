import type { AccountTitleInfo, PlCategory } from '../account-titles/account-title.types.ts'

/** 보고서 줄로 나오는 손익 구분입니다. */
export type PlLine = Exclude<PlCategory, 'NONE'>

/** 한 달(또는 한 해)의 손익입니다. 금액은 원 단위이고, 비용 줄은 양수로 적습니다. */
export interface PlFigures {
  revenueAmount: number
  costOfSalesAmount: number
  grossProfitAmount: number
  sgaAmount: number
  operatingProfitAmount: number
  nonOperatingIncomeAmount: number
  nonOperatingExpenseAmount: number
  incomeTaxAmount: number
  netIncomeAmount: number
  /** 줄 아래 보고서 계정(2단계)별 금액입니다. */
  breakdown: Array<{ line: PlLine; reportName: string; amount: number }>
}

/** 실시간 손익에 넣을 증빙 한 건입니다. */
export interface PlEvidenceEntry {
  side: 'SALES' | 'PURCHASE'
  /** 작성일자입니다. */
  date: string
  accountTitleId: string | null
  supplyAmount: number
  totalAmount: number
}

/** 실시간 손익에 넣을 입출금 한 건입니다. `amount`는 부호가 있습니다. */
export interface PlBankEntry {
  date: string
  accountTitleId: string | null
  amount: number
}

/** 실시간 손익 정책입니다. 기본은 공급가액 기준, 분류된 입출금 포함입니다. */
export interface PlPolicy {
  basis: 'SUPPLY' | 'TOTAL'
  includeBank: boolean
}

/** 실시간 손익 결과입니다. */
export interface RealtimeProfitLoss {
  months: Array<PlFigures & { month: string }>
  total: PlFigures
  unclassifiedCount: { sales: number; purchase: number; bank: number }
}

const LINE_KEYS: Record<PlLine, keyof Omit<PlFigures, 'breakdown'>> = {
  REVENUE: 'revenueAmount',
  COGS: 'costOfSalesAmount',
  SGA: 'sgaAmount',
  NON_OPERATING_INCOME: 'nonOperatingIncomeAmount',
  NON_OPERATING_EXPENSE: 'nonOperatingExpenseAmount',
  INCOME_TAX: 'incomeTaxAmount',
}

const INCOME_LINES: ReadonlySet<PlLine> = new Set(['REVENUE', 'NON_OPERATING_INCOME'])

/**
 * 분류된 증빙과 입출금으로 한 해의 월별 실시간 손익을 만듭니다.
 *
 * - 분류된 행만 셉니다. 미분류는 건수만 따로 줍니다
 * - `NONE` 계정(거래대금, 자산·부채)은 넣지 않습니다. 매출 증빙과 그 대금 입금이 두 번 잡히지 않게 하기 위해서입니다
 * - 증빙은 작성일자의 달에 공급가액(정책에 따라 합계)으로 넣습니다. 매출 증빙은 수익 쪽, 매입 증빙은 비용 쪽 부호입니다
 * - 입출금은 정책이 넣을 때만 셉니다. 증빙이 없는 급여·임차료·이자를 잡기 위해서입니다. 입금은 수익 쪽 부호입니다
 * - 매출총이익 = 매출 − 매출원가, 영업이익 = 매출총이익 − 판관비, 순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세등
 * - `cumulative`이면 각 달은 1월부터 그달까지의 누계입니다
 */
export function realtimeProfitLoss(input: {
  year: number
  cumulative: boolean
  policy: PlPolicy
  titles: ReadonlyMap<string, Pick<AccountTitleInfo, 'plCategory' | 'reportName'>>
  evidence: ReadonlyArray<PlEvidenceEntry>
  bank: ReadonlyArray<PlBankEntry>
}): RealtimeProfitLoss {
  const yearText = String(input.year)
  const months = Array.from({ length: 12 }, () => new Map<string, number>())
  const unclassifiedCount = { sales: 0, purchase: 0, bank: 0 }
  const add = (date: string, accountTitleId: string, amount: number, inflow: boolean): void => {
    const info = input.titles.get(accountTitleId)
    const bucket = months[Number(date.slice(5, 7)) - 1]
    if (info === undefined || info.plCategory === 'NONE' || bucket === undefined) return
    const signed = INCOME_LINES.has(info.plCategory) === inflow ? amount : -amount
    const key = `${info.plCategory}\u0000${info.reportName}`
    bucket.set(key, (bucket.get(key) ?? 0) + signed)
  }
  for (const row of input.evidence) {
    if (!row.date.startsWith(yearText)) continue
    if (row.accountTitleId === null) {
      unclassifiedCount[row.side === 'SALES' ? 'sales' : 'purchase']++
      continue
    }
    const amount = input.policy.basis === 'SUPPLY' ? row.supplyAmount : row.totalAmount
    add(row.date, row.accountTitleId, amount, row.side === 'SALES')
  }
  for (const row of input.bank) {
    if (!row.date.startsWith(yearText)) continue
    if (row.accountTitleId === null) {
      unclassifiedCount.bank++
      continue
    }
    if (input.policy.includeBank) add(row.date, row.accountTitleId, row.amount, true)
  }
  const running = new Map<string, number>()
  const output = months.map((bucket, index) => {
    const month = `${yearText}-${String(index + 1).padStart(2, '0')}`
    if (!input.cumulative) return { month, ...toFigures(bucket) }
    for (const [key, amount] of bucket) running.set(key, (running.get(key) ?? 0) + amount)
    return { month, ...toFigures(running) }
  })
  const total = new Map<string, number>()
  for (const bucket of months) for (const [key, amount] of bucket) total.set(key, (total.get(key) ?? 0) + amount)
  return { months: output, total: toFigures(total), unclassifiedCount }
}

function toFigures(amounts: ReadonlyMap<string, number>): PlFigures {
  const figures: PlFigures = {
    revenueAmount: 0,
    costOfSalesAmount: 0,
    grossProfitAmount: 0,
    sgaAmount: 0,
    operatingProfitAmount: 0,
    nonOperatingIncomeAmount: 0,
    nonOperatingExpenseAmount: 0,
    incomeTaxAmount: 0,
    netIncomeAmount: 0,
    breakdown: [],
  }
  for (const [key, amount] of amounts) {
    const [line, reportName] = key.split('\u0000') as [PlLine, string]
    figures[LINE_KEYS[line]] += amount
    figures.breakdown.push({ line, reportName, amount })
  }
  figures.grossProfitAmount = figures.revenueAmount - figures.costOfSalesAmount
  figures.operatingProfitAmount = figures.grossProfitAmount - figures.sgaAmount
  figures.netIncomeAmount =
    figures.operatingProfitAmount +
    figures.nonOperatingIncomeAmount -
    figures.nonOperatingExpenseAmount -
    figures.incomeTaxAmount
  return figures
}
