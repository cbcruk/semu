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

const 손익줄별필드: Record<PlLine, keyof Omit<PlFigures, 'breakdown'>> = {
  REVENUE: 'revenueAmount',
  COGS: 'costOfSalesAmount',
  SGA: 'sgaAmount',
  NON_OPERATING_INCOME: 'nonOperatingIncomeAmount',
  NON_OPERATING_EXPENSE: 'nonOperatingExpenseAmount',
  INCOME_TAX: 'incomeTaxAmount',
}

/** 수익 쪽(+)으로 더하는 손익 줄입니다. 나머지 줄은 비용 쪽입니다. */
const 수익쪽줄: ReadonlySet<PlLine> = new Set(['REVENUE', 'NON_OPERATING_INCOME'])

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
  const 연도 = String(input.year)
  const 월별줄금액 = Array.from({ length: 12 }, () => new Map<string, number>())
  const unclassifiedCount = { sales: 0, purchase: 0, bank: 0 }
  // 기준일: 증빙은 작성일자, 입출금은 거래일입니다. 수익쪽인가: 이 금액이 수익 쪽(매출 증빙·입금)에서 왔는지입니다
  const 손익에더하기 = (기준일: string, 계정과목ID: string, 금액: number, 수익쪽인가: boolean): void => {
    const 계정과목 = input.titles.get(계정과목ID)
    const bucket = 월별줄금액[Number(기준일.slice(5, 7)) - 1]
    if (계정과목 === undefined || 계정과목.plCategory === 'NONE' || bucket === undefined) return
    const 부호붙은금액 = 수익쪽줄.has(계정과목.plCategory) === 수익쪽인가 ? 금액 : -금액
    const key = `${계정과목.plCategory}\u0000${계정과목.reportName}`
    bucket.set(key, (bucket.get(key) ?? 0) + 부호붙은금액)
  }
  for (const row of input.evidence) {
    if (!row.date.startsWith(연도)) continue
    if (row.accountTitleId === null) {
      unclassifiedCount[row.side === 'SALES' ? 'sales' : 'purchase']++
      continue
    }
    const 넣을금액 = input.policy.basis === 'SUPPLY' ? row.supplyAmount : row.totalAmount
    손익에더하기(row.date, row.accountTitleId, 넣을금액, row.side === 'SALES')
  }
  for (const row of input.bank) {
    if (!row.date.startsWith(연도)) continue
    if (row.accountTitleId === null) {
      unclassifiedCount.bank++
      continue
    }
    if (input.policy.includeBank) 손익에더하기(row.date, row.accountTitleId, row.amount, true)
  }
  const 누계 = new Map<string, number>()
  const 월별손익 = 월별줄금액.map((bucket, index) => {
    const month = `${연도}-${String(index + 1).padStart(2, '0')}`
    if (!input.cumulative) return { month, ...손익집계(bucket) }
    for (const [key, amount] of bucket) 누계.set(key, (누계.get(key) ?? 0) + amount)
    return { month, ...손익집계(누계) }
  })
  const 연간줄금액 = new Map<string, number>()
  for (const bucket of 월별줄금액)
    for (const [key, amount] of bucket) 연간줄금액.set(key, (연간줄금액.get(key) ?? 0) + amount)
  return { months: 월별손익, total: 손익집계(연간줄금액), unclassifiedCount }
}

/** 줄금액: `손익 구분\0보고서 줄 이름` 키별 금액입니다. */
function 손익집계(줄금액: ReadonlyMap<string, number>): PlFigures {
  const 손익: PlFigures = {
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
  for (const [key, amount] of 줄금액) {
    const [line, reportName] = key.split('\u0000') as [PlLine, string]
    손익[손익줄별필드[line]] += amount
    손익.breakdown.push({ line, reportName, amount })
  }
  손익.grossProfitAmount = 손익.revenueAmount - 손익.costOfSalesAmount
  손익.operatingProfitAmount = 손익.grossProfitAmount - 손익.sgaAmount
  손익.netIncomeAmount =
    손익.operatingProfitAmount + 손익.nonOperatingIncomeAmount - 손익.nonOperatingExpenseAmount - 손익.incomeTaxAmount
  return 손익
}
