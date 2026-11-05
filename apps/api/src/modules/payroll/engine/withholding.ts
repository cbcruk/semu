import { applyPpm, formatPpm, formatWon, sum, truncateTo } from './engine-math.ts'
import type { NecessaryExpense, TraceEntry } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'
import { localIncomeTaxOf } from './wage-income-tax.ts'

/** 지급 한 건에서 원천징수한 소득세와 지방소득세입니다. */
export interface WithholdingResult {
  incomeTax: number
  localIncomeTax: number
  /** 소액부징수나 과세최저한으로 면제됐는지입니다. */
  exempt: boolean
  trace: TraceEntry[]
}

/**
 * 일용근로소득의 원천징수입니다.
 *
 * 일마다 `max(0, 일급 − 150,000)`에 6%를 곱하고 그 55%를 공제합니다(단계마다 원 미만 절사). 행 세액은 10원 미만
 * 절사하고, 1,000원 미만이면 0입니다(소액부징수, 지급 행 단위 판정). `dailyPays`가 없으면 총액을 균등 분할합니다.
 *
 * @example 하루 200,000원씩 5일
 * ```ts
 * withholdDailyWorker(1_000_000, 5, undefined, RATES_2026_01) // { incomeTax: 6_750, localIncomeTax: 670, ... }
 * ```
 */
export function withholdDailyWorker(
  payAmount: number,
  workDays: number,
  dailyPays: readonly number[] | undefined,
  rates: PayrollRateTable,
): WithholdingResult {
  const table = rates.dailyWorker
  const days = Math.max(1, workDays)
  const taxable =
    dailyPays === undefined
      ? splitEvenly(payAmount, days).reduce((total, pay) => total + Math.max(0, pay - table.dailyDeduction), 0)
      : sum(dailyPays.map((pay) => Math.max(0, pay - table.dailyDeduction)))
  const calculated = applyPpm(taxable, table.ratePpm)
  const credit = applyPpm(calculated, table.creditPpm)
  const raw = truncateTo(calculated - credit, rates.wageIncomeTax.taxRoundingUnit)
  const exempt = raw < rates.smallAmountExemption
  const incomeTax = exempt ? 0 : raw
  return finish(incomeTax, exempt, rates, [
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: incomeTax,
      formula: `(지급액 ${formatWon(payAmount)} − ${formatWon(table.dailyDeduction)} × ${days}일 = ${formatWon(taxable)}) × ${formatPpm(table.ratePpm)} − 근로소득세액공제 ${formatPpm(table.creditPpm)}${exempt ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/**
 * 사업소득의 원천징수입니다. 소득세 3%, 지방소득세 0.3%입니다.
 *
 * 소득세는 10원 미만 절사하고, 1,000원 미만이면 0입니다(소액부징수).
 */
export function withholdBusinessIncome(payAmount: number, rates: PayrollRateTable): WithholdingResult {
  const raw = truncateTo(applyPpm(payAmount, rates.businessIncome.ratePpm), rates.wageIncomeTax.taxRoundingUnit)
  const exempt = raw < rates.smallAmountExemption
  const incomeTax = exempt ? 0 : raw
  return finish(incomeTax, exempt, rates, [
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: incomeTax,
      formula: `${formatWon(payAmount)} × ${formatPpm(rates.businessIncome.ratePpm)}${exempt ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/** 기타소득의 필요경비입니다. 지급액을 넘지 않습니다. */
export function necessaryExpenseOf(payAmount: number, expense: NecessaryExpense): number {
  const amount = expense.kind === 'DEEMED' ? applyPpm(payAmount, expense.ratePpm) : expense.amount
  return Math.min(Math.max(0, amount), payAmount)
}

/**
 * 기타소득의 원천징수입니다.
 *
 * `기타소득금액 = 지급액 − 필요경비`. 5만원 이하이면 과세하지 않습니다(과세최저한, 건별). 아니면
 * `기타소득금액 × 20%`(또는 지급사유별 세율)를 10원 미만 절사하고, 1,000원 미만이면 0입니다.
 *
 * @example 필요경비 60%인 1,000,000원
 * ```ts
 * withholdOtherIncome(1_000_000, { kind: 'DEEMED', ratePpm: 600_000 }, undefined, RATES_2026_01)
 * // { incomeTax: 80_000, localIncomeTax: 8_000, ... }
 * ```
 */
export function withholdOtherIncome(
  payAmount: number,
  expense: NecessaryExpense,
  taxRatePpm: number | undefined,
  rates: PayrollRateTable,
): WithholdingResult {
  const expenses = necessaryExpenseOf(payAmount, expense)
  const income = payAmount - expenses
  const ratePpm = taxRatePpm ?? rates.otherIncome.ratePpm
  const belowThreshold = income <= rates.otherIncome.minimumTaxableIncome
  const raw = belowThreshold ? 0 : truncateTo(applyPpm(income, ratePpm), rates.wageIncomeTax.taxRoundingUnit)
  const exempt = belowThreshold || raw < rates.smallAmountExemption
  const incomeTax = exempt ? 0 : raw
  const note = belowThreshold
    ? ` → 과세최저한(${formatWon(rates.otherIncome.minimumTaxableIncome)}원 이하)`
    : exempt
      ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)`
      : ''
  return finish(incomeTax, exempt, rates, [
    {
      code: 'NECESSARY_EXPENSE',
      label: '필요경비',
      amount: expenses,
      formula: expense.kind === 'DEEMED' ? `${formatWon(payAmount)} × ${formatPpm(expense.ratePpm)}` : '실제 경비',
    },
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: incomeTax,
      formula: `(${formatWon(payAmount)} − ${formatWon(expenses)}) × ${formatPpm(ratePpm)}${note}`,
    },
  ])
}

/**
 * 원천징수 뒤 실지급액이 주어진 금액이 되는 지급 총액을 찾습니다(세금공제후 역산).
 *
 * 절사 때문에 실지급액이 같은 총액이 여럿일 수 있어, `실지급액 ÷ (1 − 실효세율)`에 가장 가까운 정확한 값을
 * 고릅니다(967,000 → 999,980이 아니라 1,000,000). 정확한 값이 없으면 실지급액이 목표 이상인 가장 작은 총액입니다.
 */
export function grossUpFromNet(netAmount: number, netOf: (gross: number) => number, effectiveRatePpm: number): number {
  const estimate = Math.round((netAmount * 1_000_000) / Math.max(1, 1_000_000 - effectiveRatePpm))
  let best: number | undefined
  let fallback: number | undefined
  for (let gross = Math.max(netAmount, estimate - 2_000); gross <= estimate + 2_000; gross += 1) {
    const net = netOf(gross)
    if (net === netAmount && (best === undefined || Math.abs(gross - estimate) < Math.abs(best - estimate))) {
      best = gross
    }
    if (net > netAmount && fallback === undefined) fallback = gross
  }
  return best ?? fallback ?? estimate
}

function finish(incomeTax: number, exempt: boolean, rates: PayrollRateTable, trace: TraceEntry[]): WithholdingResult {
  const localIncomeTax = localIncomeTaxOf(incomeTax, rates)
  trace.push({
    code: 'LOCAL_INCOME_TAX',
    label: '지방소득세',
    amount: localIncomeTax,
    formula: `소득세 ${formatWon(incomeTax)} × 10%`,
  })
  return { incomeTax, localIncomeTax, exempt, trace }
}

function splitEvenly(total: number, days: number): number[] {
  const share = Math.floor(total / days)
  const remainder = total - share * days
  return Array.from({ length: days }, (_, index) => share + (index < remainder ? 1 : 0))
}
