import type { SimpleTaxInput, SimpleTaxStrategy, TraceEntry, WageIncomeTaxSetting } from './engine.types'
import { applyPpm, evaluateLinear, formatWon, mulDiv, truncateTo } from './engine.utils'
import type { PayrollRateTable } from './rate-table.types'

/** Intermediate amounts of the annual 간이세액 formula, for traces and tests. */
export interface AnnualSimpleTaxSteps {
  annualPay: number
  earnedIncomeDeduction: number
  earnedIncome: number
  personalDeduction: number
  pensionDeduction: number
  specialDeduction: number
  taxBase: number
  calculatedTax: number
  earnedIncomeCredit: number
  annualTax: number
}

/** One row of a generated or official 간이세액표: pay range and monthly tax by number of dependants. */
export interface SimpleTaxTableRow {
  /** Lower bound of monthly pay (inclusive). */
  min: number
  /** Upper bound of monthly pay (exclusive). */
  max: number
  /** Monthly tax for 1 to 11 dependants, before the child credit and the withholding ratio. */
  taxes: readonly number[]
}

/** Result of {@linkcode calculateWageIncomeTax}. */
export interface WageIncomeTaxResult {
  incomeTax: number
  localIncomeTax: number
  trace: TraceEntry[]
}

/**
 * Runs the annual formula behind the 간이세액표 for one monthly pay amount.
 *
 * Steps: annualise (× 12) → 근로소득공제 (capped) → 인적공제 (1,500,000 per
 * dependant) → 연금보험료공제 (pension premium on the clamped pay × 12) →
 * 특별소득공제 estimate by dependants → progressive rates → 근로소득세액공제 and
 * its limit. Every step truncates below one won.
 */
export function annualSimpleTaxSteps(monthlyPay: number, dependants: number, rates: PayrollRateTable): AnnualSimpleTaxSteps {
  const table = rates.wageIncomeTax
  const annualPay = monthlyPay * 12
  const earnedIncomeDeduction = Math.min(evaluateLinear(table.earnedIncomeDeduction, annualPay), table.earnedIncomeDeductionCap)
  const earnedIncome = Math.max(0, annualPay - earnedIncomeDeduction)
  const personalDeduction = table.personalDeductionPerDependant * Math.max(1, dependants)
  const pension = rates.nationalPension
  const pensionBase = Math.min(Math.max(monthlyPay, pension.baseMin), pension.baseMax)
  const pensionDeduction = applyPpm(pensionBase * 12, pension.employeeRatePpm)
  const specialDeduction = specialDeductionEstimate(annualPay, dependants, rates)
  const taxBase = Math.max(0, earnedIncome - personalDeduction - pensionDeduction - specialDeduction)
  const calculatedTax = progressiveTax(taxBase, rates)
  const earnedIncomeCredit = Math.min(earnedIncomeCreditOf(calculatedTax, rates), earnedIncomeCreditLimit(annualPay, rates))
  return {
    annualPay,
    earnedIncomeDeduction,
    earnedIncome,
    personalDeduction,
    pensionDeduction,
    specialDeduction,
    taxBase,
    calculatedTax,
    earnedIncomeCredit,
    annualTax: Math.max(0, calculatedTax - earnedIncomeCredit),
  }
}

/** Applies the progressive income tax rates to a tax base, truncating below one won. */
export function progressiveTax(taxBase: number, rates: PayrollRateTable): number {
  const bracket = rates.wageIncomeTax.brackets.find((candidate) => candidate.upTo === null || taxBase <= candidate.upTo)
  if (bracket === undefined || taxBase <= 0) return 0
  return Math.max(0, applyPpm(taxBase, bracket.ratePpm) - bracket.progressiveDeduction)
}

/** Monthly 자녀세액공제 deducted from the 간이세액 for children aged 8 to 20. */
export function childTaxCredit(children: number, rates: PayrollRateTable): number {
  const credit = rates.wageIncomeTax.childCreditMonthly
  if (children <= 0) return 0
  if (children === 1) return credit.one
  return credit.two + (children - 2) * credit.perAdditional
}

/**
 * 간이세액 computed with the formula on the exact monthly pay.
 *
 * Differs from the official table by up to the tax on half a table row
 * (2,500–10,000 won of pay), because the table evaluates each row's midpoint.
 */
export const EXACT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-exact',
  monthlyTax: (input, rates) => formulaMonthlyTax(input.monthlyTaxablePay, input, rates),
}

/**
 * 간이세액 computed with the formula on the midpoint of the 간이세액표 row the pay falls in.
 *
 * This reproduces how the official table is built. Remaining differences come
 * from the unverified coefficients of the 특별소득공제 estimate, so treat the
 * result as an estimate until the official table is loaded through
 * {@linkcode lookupSimpleTaxTable}.
 */
export const MIDPOINT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-midpoint',
  monthlyTax: (input, rates) => formulaMonthlyTax(tableMidpoint(input.monthlyTaxablePay, rates), input, rates),
}

/**
 * Builds a strategy that reads monthly tax from loaded 간이세액표 rows.
 *
 * Pay above the last row and dependants beyond the row's columns fall back to
 * `fallback`; pay below the first row is taxed at zero.
 *
 * @example Plugging in the official table
 * ```ts
 * import { lookupSimpleTaxTable, MIDPOINT_FORMULA } from './wage-income-tax'
 *
 * const strategy = lookupSimpleTaxTable([{ min: 3_000_000, max: 3_020_000, taxes: [74_350] }], MIDPOINT_FORMULA)
 * ```
 */
export function lookupSimpleTaxTable(rows: readonly SimpleTaxTableRow[], fallback: SimpleTaxStrategy): SimpleTaxStrategy {
  const sorted = [...rows].sort((a, b) => a.min - b.min)
  return {
    name: 'table-lookup',
    monthlyTax: (input, rates): number => {
      const first = sorted[0]
      if (first !== undefined && input.monthlyTaxablePay < first.min) return 0
      const row = sorted.find((candidate) => input.monthlyTaxablePay >= candidate.min && input.monthlyTaxablePay < candidate.max)
      const tax = row?.taxes[Math.max(1, input.dependants) - 1]
      if (tax === undefined) return fallback.monthlyTax(input, rates)
      return Math.max(0, tax - childTaxCredit(input.childrenAged8To20, rates))
    },
  }
}

/**
 * Generates 간이세액표 rows from the formula, one row per table band step.
 *
 * Used by `GET /api/tax-rates/simple` until the official table is loaded.
 */
export function generateSimpleTaxTable(rates: PayrollRateTable, maxDependants = 11): SimpleTaxTableRow[] {
  const rows: SimpleTaxTableRow[] = []
  for (const band of rates.wageIncomeTax.tableRowBands) {
    for (let min = band.from; min < band.to; min += band.step) {
      const midpoint = min + band.step / 2
      const taxes = Array.from({ length: maxDependants }, (_, index) =>
        formulaMonthlyTax(midpoint, { monthlyTaxablePay: midpoint, dependants: index + 1, childrenAged8To20: 0 }, rates),
      )
      rows.push({ min, max: min + band.step, taxes })
    }
  }
  return rows
}

/**
 * Calculates the monthly wage income tax and local income tax of one row.
 *
 * Order: 간이세액 by the strategy (child credit included) → 중소기업 취업자
 * 감면 → withholding ratio (80/100/120%) → truncate below 10 won. Local income
 * tax is 10% of the income tax, truncated below 10 won. `manual_input` takes
 * the given amount; `none` withholds nothing.
 *
 * @example 3,000,000 won, one dependant, exact formula
 * ```ts
 * import { calculateWageIncomeTax, EXACT_FORMULA } from './wage-income-tax'
 * import { RATES_2026_01 } from './rate-table-2026'
 *
 * calculateWageIncomeTax(
 *   3_000_000,
 *   { method: 'tax_table_based', dependants: 1, childrenAged8To20: 0, withholdingRatio: 100 },
 *   RATES_2026_01,
 *   EXACT_FORMULA,
 * ) // { incomeTax: 59_080, localIncomeTax: 5_900, ... }
 * ```
 */
export function calculateWageIncomeTax(
  monthlyTaxablePay: number,
  setting: WageIncomeTaxSetting,
  rates: PayrollRateTable,
  strategy: SimpleTaxStrategy,
): WageIncomeTaxResult {
  const unit = rates.wageIncomeTax.taxRoundingUnit
  if (setting.method === 'none') return { incomeTax: 0, localIncomeTax: 0, trace: [] }
  let incomeTax: number
  let formula: string
  if (setting.method === 'manual_input') {
    incomeTax = setting.manualAmount ?? 0
    formula = '직접 입력'
  } else {
    const simple = strategy.monthlyTax(
      { monthlyTaxablePay, dependants: setting.dependants, childrenAged8To20: setting.childrenAged8To20 },
      rates,
    )
    const reduction = setting.reduction === undefined ? 0 : Math.min(applyPpm(simple, setting.reduction.ratePpm), setting.reduction.remainingAnnualLimit)
    incomeTax = truncateTo(mulDiv(Math.max(0, simple - reduction), setting.withholdingRatio, 100), unit)
    formula = `간이세액(${strategy.name}) ${formatWon(simple)}${reduction > 0 ? ` − 감면 ${formatWon(reduction)}` : ''} × ${setting.withholdingRatio}% (공제대상가족 ${setting.dependants}명, 8~20세 자녀 ${setting.childrenAged8To20}명, ${unit}원 미만 절사)`
  }
  const localIncomeTax = localIncomeTaxOf(incomeTax, rates)
  return {
    incomeTax,
    localIncomeTax,
    trace: [
      { code: 'income_tax', label: '소득세', amount: incomeTax, formula },
      { code: 'local_income_tax', label: '지방소득세', amount: localIncomeTax, formula: `소득세 ${formatWon(incomeTax)} × 10% (${rates.localIncomeTax.roundingUnit}원 미만 절사)` },
    ],
  }
}

/** Local income tax (지방소득세) on an income tax amount: 10%, truncated per the table. */
export function localIncomeTaxOf(incomeTax: number, rates: PayrollRateTable): number {
  return truncateTo(applyPpm(incomeTax, rates.localIncomeTax.ratePpm), rates.localIncomeTax.roundingUnit)
}

function formulaMonthlyTax(pay: number, input: SimpleTaxInput, rates: PayrollRateTable): number {
  const table = rates.wageIncomeTax
  let monthly: number
  if (pay > table.highIncomeThreshold) {
    const atThreshold = Math.floor(annualSimpleTaxSteps(table.highIncomeThreshold, input.dependants, rates).annualTax / 12)
    monthly = truncateTo(atThreshold, table.taxRoundingUnit) + evaluateLinear(table.highIncomeBrackets, pay)
  } else if (pay < table.tableMinimumPay) {
    monthly = 0
  } else {
    monthly = Math.floor(annualSimpleTaxSteps(pay, input.dependants, rates).annualTax / 12)
  }
  return truncateTo(Math.max(0, truncateTo(monthly, table.taxRoundingUnit) - childTaxCredit(input.childrenAged8To20, rates)), table.taxRoundingUnit)
}

function tableMidpoint(pay: number, rates: PayrollRateTable): number {
  const band = rates.wageIncomeTax.tableRowBands.find((candidate) => pay >= candidate.from && pay < candidate.to)
  if (band === undefined) return pay
  const min = band.from + Math.floor((pay - band.from) / band.step) * band.step
  return min + band.step / 2
}

function specialDeductionEstimate(annualPay: number, dependants: number, rates: PayrollRateTable): number {
  const groups = [...rates.wageIncomeTax.specialDeductionByDependants].sort((a, b) => b.minDependants - a.minDependants)
  const group = groups.find((candidate) => dependants >= candidate.minDependants)
  const bracket = group?.brackets.find((candidate) => candidate.upTo === null || annualPay <= candidate.upTo)
  if (bracket === undefined) return 0
  let value = bracket.base + applyPpm(annualPay, bracket.ratePpm)
  for (const adjustment of bracket.adjustments) value += applyPpm(Math.max(0, annualPay - adjustment.over), adjustment.ratePpm)
  return Math.max(0, value)
}

function earnedIncomeCreditOf(calculatedTax: number, rates: PayrollRateTable): number {
  const credit = rates.wageIncomeTax.earnedIncomeCredit
  if (calculatedTax <= credit.threshold) return applyPpm(calculatedTax, credit.lowRatePpm)
  return credit.baseAbove + applyPpm(calculatedTax - credit.threshold, credit.highRatePpm)
}

function earnedIncomeCreditLimit(annualPay: number, rates: PayrollRateTable): number {
  const limit = rates.wageIncomeTax.earnedIncomeCreditLimits.find((candidate) => candidate.upTo === null || annualPay <= candidate.upTo)
  if (limit === undefined) return 0
  return Math.max(limit.floor, limit.base - applyPpm(Math.max(0, annualPay - limit.over), limit.reductionPpm))
}
