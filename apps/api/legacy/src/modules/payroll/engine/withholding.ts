import type { NecessaryExpense, TraceEntry } from './engine.types'
import { applyPpm, formatPpm, formatWon, sum, truncateTo } from './engine.utils'
import type { PayrollRateTable } from './rate-table.types'
import { localIncomeTaxOf } from './wage-income-tax'

/** Income tax and local income tax withheld from one payment. */
export interface WithholdingResult {
  incomeTax: number
  localIncomeTax: number
  /** Whether the tax was waived by 소액부징수 or 과세최저한. */
  exempt: boolean
  trace: TraceEntry[]
}

/**
 * Withholds tax from daily worker pay (일용근로소득).
 *
 * Per day, `max(0, 일급 − 150,000)` is taxed at 6% and 55% of that is credited
 * (each step truncated below one won). The row's tax is truncated below 10 won
 * and waived when under 1,000 won (소액부징수, judged per payment row). When
 * `dailyPays` is omitted the total is split evenly, which makes the taxable
 * amount `max(0, total − 150,000 × days)` when every day is above the deduction.
 *
 * @example 200,000 won a day for 5 days
 * ```ts
 * import { withholdDailyWorker } from './withholding'
 * import { RATES_2026_01 } from './rate-table-2026'
 *
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
      ? Math.max(0, splitEvenly(payAmount, days).reduce((total, pay) => total + Math.max(0, pay - table.dailyDeduction), 0))
      : sum(dailyPays.map((pay) => Math.max(0, pay - table.dailyDeduction)))
  const calculated = applyPpm(taxable, table.ratePpm)
  const credit = applyPpm(calculated, table.creditPpm)
  const raw = truncateTo(calculated - credit, rates.wageIncomeTax.taxRoundingUnit)
  const exempt = raw < rates.smallAmountExemption
  const incomeTax = exempt ? 0 : raw
  return finish(incomeTax, exempt, rates, [
    {
      code: 'income_tax',
      label: '소득세',
      amount: incomeTax,
      formula: `(지급액 ${formatWon(payAmount)} − ${formatWon(table.dailyDeduction)} × ${days}일 = ${formatWon(taxable)}) × ${formatPpm(table.ratePpm)} − 근로소득세액공제 ${formatPpm(table.creditPpm)}${exempt ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/**
 * Withholds tax from business income (사업소득): 3% income tax and 0.3% local tax.
 *
 * The income tax is truncated below 10 won and waived under 1,000 won (소액부징수).
 */
export function withholdBusinessIncome(payAmount: number, rates: PayrollRateTable): WithholdingResult {
  const raw = truncateTo(applyPpm(payAmount, rates.businessIncome.ratePpm), rates.wageIncomeTax.taxRoundingUnit)
  const exempt = raw < rates.smallAmountExemption
  const incomeTax = exempt ? 0 : raw
  return finish(incomeTax, exempt, rates, [
    {
      code: 'income_tax',
      label: '소득세',
      amount: incomeTax,
      formula: `${formatWon(payAmount)} × ${formatPpm(rates.businessIncome.ratePpm)}${exempt ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/** Resolves the necessary expenses of an other-income payment, capped at the payment. */
export function necessaryExpenseOf(payAmount: number, expense: NecessaryExpense): number {
  const amount = expense.kind === 'deemed' ? applyPpm(payAmount, expense.ratePpm) : expense.amount
  return Math.min(Math.max(0, amount), payAmount)
}

/**
 * Withholds tax from other income (기타소득).
 *
 * `기타소득금액 = 지급액 − 필요경비`. When it is 50,000 won or less the payment
 * is not taxed (과세최저한, per payment). Otherwise the income tax is
 * `기타소득금액 × 20%` (or the given rate), truncated below 10 won and waived
 * under 1,000 won.
 *
 * @example 1,000,000 won with 60% deemed expenses
 * ```ts
 * import { withholdOtherIncome } from './withholding'
 * import { RATES_2026_01 } from './rate-table-2026'
 *
 * withholdOtherIncome(1_000_000, { kind: 'deemed', ratePpm: 600_000 }, undefined, RATES_2026_01)
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
    { code: 'necessary_expense', label: '필요경비', amount: expenses, formula: expense.kind === 'deemed' ? `${formatWon(payAmount)} × ${formatPpm(expense.ratePpm)}` : '실제 경비' },
    { code: 'income_tax', label: '소득세', amount: incomeTax, formula: `(${formatWon(payAmount)} − ${formatWon(expenses)}) × ${formatPpm(ratePpm)}${note}` },
  ])
}

/**
 * Finds the gross payment whose net after withholding equals the given net (세금공제후 역산).
 *
 * Truncation makes several gross amounts share one net amount, so the search
 * returns the exact match closest to `net ÷ (1 − effective rate)` (967,000 →
 * 1,000,000 rather than 999,980), or else the smallest gross whose net is not
 * below the target.
 */
export function grossUpFromNet(netAmount: number, netOf: (gross: number) => number, effectiveRatePpm: number): number {
  const estimate = Math.round((netAmount * 1_000_000) / Math.max(1, 1_000_000 - effectiveRatePpm))
  let best: number | undefined
  let fallback: number | undefined
  for (let gross = Math.max(netAmount, estimate - 2_000); gross <= estimate + 2_000; gross += 1) {
    const net = netOf(gross)
    if (net === netAmount && (best === undefined || Math.abs(gross - estimate) < Math.abs(best - estimate))) best = gross
    if (net > netAmount && fallback === undefined) fallback = gross
  }
  return best ?? fallback ?? estimate
}

function finish(incomeTax: number, exempt: boolean, rates: PayrollRateTable, trace: TraceEntry[]): WithholdingResult {
  const localIncomeTax = localIncomeTaxOf(incomeTax, rates)
  trace.push({ code: 'local_income_tax', label: '지방소득세', amount: localIncomeTax, formula: `소득세 ${formatWon(incomeTax)} × 10%` })
  return { incomeTax, localIncomeTax, exempt, trace }
}

function splitEvenly(total: number, days: number): number[] {
  const share = Math.floor(total / days)
  const remainder = total - share * days
  return Array.from({ length: days }, (_, index) => share + (index < remainder ? 1 : 0))
}
