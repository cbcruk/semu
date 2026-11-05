import { applyPpm, evaluateLinear, formatPpm, formatWon, mulDiv, truncateTo } from './engine-math.ts'
import type { SimpleTaxInput, SimpleTaxStrategy, TraceEntry, WageIncomeTaxSetting } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'

/** 간이세액 연 산식의 중간 금액입니다. 계산식 표시와 테스트에 씁니다. */
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

/** 간이세액표 한 행입니다. 월 급여 구간과 공제대상가족 수별 월 세액입니다. */
export interface SimpleTaxTableRow {
  /** 월 급여 하한(이상)입니다. */
  min: number
  /** 월 급여 상한(미만)입니다. */
  max: number
  /** 공제대상가족 1~11명의 월 세액입니다. 자녀세액공제와 원천징수 비율을 적용하기 전입니다. */
  taxes: readonly number[]
}

/** {@link calculateWageIncomeTax}의 결과입니다. */
export interface WageIncomeTaxResult {
  incomeTax: number
  localIncomeTax: number
  trace: TraceEntry[]
}

/**
 * 월 급여 하나로 간이세액표의 연 산식을 계산합니다.
 *
 * 단계: 연 환산(× 12) → 근로소득공제(한도) → 인적공제(1인 150만원) → 연금보험료공제(상하한을 적용한 월급 ×
 * 근로자 요율 × 12) → 가족 수별 특별소득공제(소득세법 시행령 별표 2 제1호 계산식) → 기본세율 → 근로소득세액공제와 한도. 단계마다 원 미만 절사입니다.
 */
export function annualSimpleTaxSteps(
  monthlyPay: number,
  dependants: number,
  rates: PayrollRateTable,
): AnnualSimpleTaxSteps {
  const table = rates.wageIncomeTax
  const annualPay = monthlyPay * 12
  const earnedIncomeDeduction = Math.min(
    evaluateLinear(table.earnedIncomeDeduction, annualPay),
    table.earnedIncomeDeductionCap,
  )
  const earnedIncome = Math.max(0, annualPay - earnedIncomeDeduction)
  const personalDeduction = table.personalDeductionPerDependant * Math.max(1, dependants)
  const pension = rates.nationalPension
  const pensionBase = Math.min(Math.max(monthlyPay, pension.baseMin), pension.baseMax)
  const pensionDeduction = applyPpm(pensionBase * 12, pension.employeeRatePpm)
  const specialDeduction = specialDeductionEstimate(annualPay, dependants, rates)
  const taxBase = Math.max(0, earnedIncome - personalDeduction - pensionDeduction - specialDeduction)
  const calculatedTax = progressiveTax(taxBase, rates)
  const earnedIncomeCredit = Math.min(
    earnedIncomeCreditOf(calculatedTax, rates),
    earnedIncomeCreditLimit(annualPay, rates),
  )
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

/** 과세표준에 기본세율을 적용합니다. 원 미만 절사입니다. */
export function progressiveTax(taxBase: number, rates: PayrollRateTable): number {
  const bracket = rates.wageIncomeTax.brackets.find((candidate) => candidate.upTo === null || taxBase <= candidate.upTo)
  if (bracket === undefined || taxBase <= 0) return 0
  return Math.max(0, applyPpm(taxBase, bracket.ratePpm) - bracket.progressiveDeduction)
}

/** 8~20세 자녀 수에 따른 월 자녀세액공제입니다. 간이세액에서 뺍니다. */
export function childTaxCredit(children: number, rates: PayrollRateTable): number {
  const credit = rates.wageIncomeTax.childCreditMonthly
  if (children <= 0) return 0
  if (children === 1) return credit.one
  return credit.two + (children - 2) * credit.perAdditional
}

/**
 * 실제 월 급여로 산식을 계산한 간이세액입니다.
 *
 * 공식 표는 행 중간값으로 계산하므로 행 폭 절반(2,500~10,000원)의 급여에 대한 세액만큼 다를 수 있습니다.
 */
export const EXACT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-exact',
  monthlyTax: (input, rates) => formulaMonthlyTax(input.monthlyTaxablePay, input, rates),
}

/**
 * 급여가 속한 간이세액표 행의 중간값으로 산식을 계산한 간이세액입니다. 기본 전략입니다.
 *
 * 공식 표를 만드는 방식과 같습니다. 계수는 별표 2 원문으로 확인했지만 표 금액과는 차이가 남으므로(review.md D4),
 * {@link lookupSimpleTaxTable}로 공식 표를 넣기 전까지 결과는 추정치이고 `wageIncomeTax.simpleTaxStrategy`가 미확인입니다.
 */
export const MIDPOINT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-midpoint',
  monthlyTax: (input, rates) => formulaMonthlyTax(tableMidpoint(input.monthlyTaxablePay, rates), input, rates),
}

/**
 * 간이세액표 행에서 월 세액을 읽는 전략을 만듭니다.
 *
 * 마지막 행보다 큰 급여와 행에 없는 가족 수는 `fallback`으로 계산하고, 첫 행보다 작은 급여는 0입니다.
 *
 * @example 공식 표 넣기
 * ```ts
 * const strategy = lookupSimpleTaxTable([{ min: 3_000_000, max: 3_020_000, taxes: [74_350] }], MIDPOINT_FORMULA)
 * ```
 */
export function lookupSimpleTaxTable(
  rows: readonly SimpleTaxTableRow[],
  fallback: SimpleTaxStrategy,
): SimpleTaxStrategy {
  const sorted = [...rows].sort((a, b) => a.min - b.min)
  return {
    name: 'table-lookup',
    monthlyTax: (input, rates): number => {
      const first = sorted[0]
      if (first !== undefined && input.monthlyTaxablePay < first.min) return 0
      const row = sorted.find(
        (candidate) => input.monthlyTaxablePay >= candidate.min && input.monthlyTaxablePay < candidate.max,
      )
      const tax = row?.taxes[Math.max(1, input.dependants) - 1]
      if (tax === undefined) return fallback.monthlyTax(input, rates)
      return Math.max(0, tax - childTaxCredit(input.childrenAged8To20, rates))
    },
  }
}

/** 산식으로 간이세액표 행을 만듭니다. 공식 표를 넣기 전까지 기준표 조회 응답에 씁니다. */
export function generateSimpleTaxTable(rates: PayrollRateTable, maxDependants = 11): SimpleTaxTableRow[] {
  const rows: SimpleTaxTableRow[] = []
  for (const band of rates.wageIncomeTax.tableRowBands) {
    for (let min = band.from; min < band.to; min += band.step) {
      const midpoint = min + band.step / 2
      const taxes = Array.from({ length: maxDependants }, (_, index) =>
        formulaMonthlyTax(
          midpoint,
          { monthlyTaxablePay: midpoint, dependants: index + 1, childrenAged8To20: 0 },
          rates,
        ),
      )
      rows.push({ min, max: min + band.step, taxes })
    }
  }
  return rows
}

/**
 * 행 하나의 월 근로소득세와 지방소득세를 계산합니다.
 *
 * 순서: 전략으로 간이세액(자녀세액공제 포함) → 중소기업 취업자 감면 → 원천징수 비율(80/100/120%) →
 * 10원 미만 절사. 지방소득세는 소득세의 10%를 10원 미만 절사합니다. `MANUAL`은 받은 금액을, `NONE`은 0을 씁니다.
 *
 * @example 월 3,000,000원, 공제대상가족 1명, 실제 급여 산식
 * ```ts
 * calculateWageIncomeTax(
 *   3_000_000,
 *   { method: 'TAX_TABLE', dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000 },
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
  if (setting.method === 'NONE') return { incomeTax: 0, localIncomeTax: 0, trace: [] }
  let incomeTax: number
  let formula: string
  if (setting.method === 'MANUAL') {
    incomeTax = setting.manualAmount ?? 0
    formula = '직접 입력'
  } else {
    const simple = strategy.monthlyTax(
      { monthlyTaxablePay, dependants: setting.dependants, childrenAged8To20: setting.childrenAged8To20 },
      rates,
    )
    const reduction =
      setting.reduction === undefined
        ? 0
        : Math.min(applyPpm(simple, setting.reduction.ratePpm), setting.reduction.remainingAnnualLimit)
    incomeTax = truncateTo(mulDiv(Math.max(0, simple - reduction), setting.withholdingRatePpm, 1_000_000), unit)
    formula = `간이세액(${strategy.name}) ${formatWon(simple)}${reduction > 0 ? ` − 감면 ${formatWon(reduction)}` : ''} × ${formatPpm(setting.withholdingRatePpm)} (공제대상가족 ${setting.dependants}명, 8~20세 자녀 ${setting.childrenAged8To20}명, ${unit}원 미만 절사)`
  }
  const localIncomeTax = localIncomeTaxOf(incomeTax, rates)
  return {
    incomeTax,
    localIncomeTax,
    trace: [
      { code: 'INCOME_TAX', label: '소득세', amount: incomeTax, formula },
      {
        code: 'LOCAL_INCOME_TAX',
        label: '지방소득세',
        amount: localIncomeTax,
        formula: `소득세 ${formatWon(incomeTax)} × 10% (${rates.localIncomeTax.roundingUnit}원 미만 절사)`,
      },
    ],
  }
}

/** 소득세에 대한 지방소득세입니다. 10%를 기준표 단위로 절사합니다. */
export function localIncomeTaxOf(incomeTax: number, rates: PayrollRateTable): number {
  return truncateTo(applyPpm(incomeTax, rates.localIncomeTax.ratePpm), rates.localIncomeTax.roundingUnit)
}

function formulaMonthlyTax(pay: number, input: SimpleTaxInput, rates: PayrollRateTable): number {
  const table = rates.wageIncomeTax
  let monthly: number
  if (pay > table.highIncomeThreshold) {
    const atThreshold = Math.floor(
      annualSimpleTaxSteps(table.highIncomeThreshold, input.dependants, rates).annualTax / 12,
    )
    monthly = truncateTo(atThreshold, table.taxRoundingUnit) + evaluateLinear(table.highIncomeBrackets, pay)
  } else if (pay < table.tableMinimumPay) {
    monthly = 0
  } else {
    monthly = Math.floor(annualSimpleTaxSteps(pay, input.dependants, rates).annualTax / 12)
  }
  return truncateTo(
    Math.max(0, truncateTo(monthly, table.taxRoundingUnit) - childTaxCredit(input.childrenAged8To20, rates)),
    table.taxRoundingUnit,
  )
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
  for (const adjustment of bracket.adjustments) {
    value += applyPpm(Math.max(0, annualPay - adjustment.over), adjustment.ratePpm)
  }
  return Math.max(0, value)
}

function earnedIncomeCreditOf(calculatedTax: number, rates: PayrollRateTable): number {
  const credit = rates.wageIncomeTax.earnedIncomeCredit
  if (calculatedTax <= credit.threshold) return applyPpm(calculatedTax, credit.lowRatePpm)
  return credit.baseAbove + applyPpm(calculatedTax - credit.threshold, credit.highRatePpm)
}

function earnedIncomeCreditLimit(annualPay: number, rates: PayrollRateTable): number {
  const limit = rates.wageIncomeTax.earnedIncomeCreditLimits.find(
    (candidate) => candidate.upTo === null || annualPay <= candidate.upTo,
  )
  if (limit === undefined) return 0
  return Math.max(limit.floor, limit.base - applyPpm(Math.max(0, annualPay - limit.over), limit.reductionPpm))
}
