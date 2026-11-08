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
  const 근로소득세기준 = rates.wageIncomeTax
  const 총급여액 = monthlyPay * 12
  const 근로소득공제 = Math.min(
    evaluateLinear(근로소득세기준.earnedIncomeDeduction, 총급여액),
    근로소득세기준.earnedIncomeDeductionCap,
  )
  const 근로소득금액 = Math.max(0, 총급여액 - 근로소득공제)
  const 인적공제 = 근로소득세기준.personalDeductionPerDependant * Math.max(1, dependants)
  const 국민연금기준 = rates.nationalPension
  // 국민연금 기준소득월액의 상하한만 적용한 월 급여(천원 미만 절사 전)
  const 상하한적용월급 = Math.min(Math.max(monthlyPay, 국민연금기준.baseMin), 국민연금기준.baseMax)
  const 연금보험료공제 = applyPpm(상하한적용월급 * 12, 국민연금기준.employeeRatePpm)
  const 특별소득공제 = 특별소득공제추정(총급여액, dependants, rates)
  const 과세표준 = Math.max(0, 근로소득금액 - 인적공제 - 연금보험료공제 - 특별소득공제)
  const 산출세액 = progressiveTax(과세표준, rates)
  const 근로소득세액공제 = Math.min(한도전근로소득세액공제(산출세액, rates), 근로소득세액공제한도(총급여액, rates))
  return {
    annualPay: 총급여액,
    earnedIncomeDeduction: 근로소득공제,
    earnedIncome: 근로소득금액,
    personalDeduction: 인적공제,
    pensionDeduction: 연금보험료공제,
    specialDeduction: 특별소득공제,
    taxBase: 과세표준,
    calculatedTax: 산출세액,
    earnedIncomeCredit: 근로소득세액공제,
    annualTax: Math.max(0, 산출세액 - 근로소득세액공제),
  }
}

/** 과세표준에 기본세율을 적용합니다. 원 미만 절사입니다. */
export function progressiveTax(taxBase: number, rates: PayrollRateTable): number {
  const 세율구간 = rates.wageIncomeTax.brackets.find(
    (candidate) => candidate.upTo === null || taxBase <= candidate.upTo,
  )
  if (세율구간 === undefined || taxBase <= 0) return 0
  return Math.max(0, applyPpm(taxBase, 세율구간.ratePpm) - 세율구간.progressiveDeduction)
}

/** 8~20세 자녀 수에 따른 월 자녀세액공제입니다. 간이세액에서 뺍니다. */
export function childTaxCredit(children: number, rates: PayrollRateTable): number {
  const 자녀세액공제기준 = rates.wageIncomeTax.childCreditMonthly
  if (children <= 0) return 0
  if (children === 1) return 자녀세액공제기준.one
  return 자녀세액공제기준.two + (children - 2) * 자녀세액공제기준.perAdditional
}

/**
 * 실제 월 급여로 산식을 계산한 간이세액입니다.
 *
 * 공식 표는 행 중간값으로 계산하므로 행 폭 절반(2,500~10,000원)의 급여에 대한 세액만큼 다를 수 있습니다.
 */
export const EXACT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-exact',
  monthlyTax: (input, rates) => 산식월세액(input.monthlyTaxablePay, input, rates),
}

/**
 * 급여가 속한 간이세액표 행의 중간값으로 산식을 계산한 간이세액입니다. 기본 전략입니다.
 *
 * 공식 표를 만드는 방식과 같습니다. 계수는 별표 2 원문으로 확인했지만 표 금액과는 차이가 남으므로(review.md D4),
 * {@link lookupSimpleTaxTable}로 공식 표를 넣기 전까지 결과는 추정치이고 `wageIncomeTax.simpleTaxStrategy`가 미확인입니다.
 */
export const MIDPOINT_FORMULA: SimpleTaxStrategy = {
  name: 'formula-midpoint',
  monthlyTax: (input, rates) => 산식월세액(행중간값(input.monthlyTaxablePay, rates), input, rates),
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
      const 첫행 = sorted[0]
      if (첫행 !== undefined && input.monthlyTaxablePay < 첫행.min) return 0
      const row = sorted.find(
        (candidate) => input.monthlyTaxablePay >= candidate.min && input.monthlyTaxablePay < candidate.max,
      )
      const 월세액 = row?.taxes[Math.max(1, input.dependants) - 1]
      if (월세액 === undefined) return fallback.monthlyTax(input, rates)
      return Math.max(0, 월세액 - childTaxCredit(input.childrenAged8To20, rates))
    },
  }
}

/** 산식으로 간이세액표 행을 만듭니다. 공식 표를 넣기 전까지 기준표 조회 응답에 씁니다. */
export function generateSimpleTaxTable(rates: PayrollRateTable, maxDependants = 11): SimpleTaxTableRow[] {
  const rows: SimpleTaxTableRow[] = []
  for (const band of rates.wageIncomeTax.tableRowBands) {
    for (let min = band.from; min < band.to; min += band.step) {
      const 중간값 = min + band.step / 2
      const taxes = Array.from({ length: maxDependants }, (_, index) =>
        산식월세액(중간값, { monthlyTaxablePay: 중간값, dependants: index + 1, childrenAged8To20: 0 }, rates),
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
  const 절사단위 = rates.wageIncomeTax.taxRoundingUnit
  if (setting.method === 'NONE') return { incomeTax: 0, localIncomeTax: 0, trace: [] }
  let 소득세: number
  let 계산식: string
  if (setting.method === 'MANUAL') {
    소득세 = setting.manualAmount ?? 0
    계산식 = '직접 입력'
  } else {
    const 간이세액 = strategy.monthlyTax(
      { monthlyTaxablePay, dependants: setting.dependants, childrenAged8To20: setting.childrenAged8To20 },
      rates,
    )
    const 감면세액 =
      setting.reduction === undefined
        ? 0
        : Math.min(applyPpm(간이세액, setting.reduction.ratePpm), setting.reduction.remainingAnnualLimit)
    소득세 = truncateTo(mulDiv(Math.max(0, 간이세액 - 감면세액), setting.withholdingRatePpm, 1_000_000), 절사단위)
    계산식 = `간이세액(${strategy.name}) ${formatWon(간이세액)}${감면세액 > 0 ? ` − 감면 ${formatWon(감면세액)}` : ''} × ${formatPpm(setting.withholdingRatePpm)} (공제대상가족 ${setting.dependants}명, 8~20세 자녀 ${setting.childrenAged8To20}명, ${절사단위}원 미만 절사)`
  }
  const 지방소득세 = localIncomeTaxOf(소득세, rates)
  return {
    incomeTax: 소득세,
    localIncomeTax: 지방소득세,
    trace: [
      { code: 'INCOME_TAX', label: '소득세', amount: 소득세, formula: 계산식 },
      {
        code: 'LOCAL_INCOME_TAX',
        label: '지방소득세',
        amount: 지방소득세,
        formula: `소득세 ${formatWon(소득세)} × 10% (${rates.localIncomeTax.roundingUnit}원 미만 절사)`,
      },
    ],
  }
}

/** 소득세에 대한 지방소득세입니다. 10%를 기준표 단위로 절사합니다. */
export function localIncomeTaxOf(incomeTax: number, rates: PayrollRateTable): number {
  return truncateTo(applyPpm(incomeTax, rates.localIncomeTax.ratePpm), rates.localIncomeTax.roundingUnit)
}

function 산식월세액(월급여: number, input: SimpleTaxInput, rates: PayrollRateTable): number {
  const 근로소득세기준 = rates.wageIncomeTax
  let 월세액: number
  if (월급여 > 근로소득세기준.highIncomeThreshold) {
    // 고소득 구간이 시작하는 월급여(highIncomeThreshold, 10,000,000원) 지점의 월 세액
    const 고소득기준월세액 = Math.floor(
      annualSimpleTaxSteps(근로소득세기준.highIncomeThreshold, input.dependants, rates).annualTax / 12,
    )
    월세액 =
      truncateTo(고소득기준월세액, 근로소득세기준.taxRoundingUnit) +
      evaluateLinear(근로소득세기준.highIncomeBrackets, 월급여)
  } else if (월급여 < 근로소득세기준.tableMinimumPay) {
    월세액 = 0
  } else {
    월세액 = Math.floor(annualSimpleTaxSteps(월급여, input.dependants, rates).annualTax / 12)
  }
  return truncateTo(
    Math.max(0, truncateTo(월세액, 근로소득세기준.taxRoundingUnit) - childTaxCredit(input.childrenAged8To20, rates)),
    근로소득세기준.taxRoundingUnit,
  )
}

function 행중간값(월급여: number, rates: PayrollRateTable): number {
  const 행구간 = rates.wageIncomeTax.tableRowBands.find(
    (candidate) => 월급여 >= candidate.from && 월급여 < candidate.to,
  )
  if (행구간 === undefined) return 월급여
  const 행하한 = 행구간.from + Math.floor((월급여 - 행구간.from) / 행구간.step) * 행구간.step
  return 행하한 + 행구간.step / 2
}

function 특별소득공제추정(총급여액: number, 공제대상가족수: number, rates: PayrollRateTable): number {
  const 가족수별구간 = [...rates.wageIncomeTax.specialDeductionByDependants].sort(
    (a, b) => b.minDependants - a.minDependants,
  )
  const 가족수구간 = 가족수별구간.find((candidate) => 공제대상가족수 >= candidate.minDependants)
  const 급여구간 = 가족수구간?.brackets.find((candidate) => candidate.upTo === null || 총급여액 <= candidate.upTo)
  if (급여구간 === undefined) return 0
  let 공제액 = 급여구간.base + applyPpm(총급여액, 급여구간.ratePpm)
  for (const adjustment of 급여구간.adjustments) {
    공제액 += applyPpm(Math.max(0, 총급여액 - adjustment.over), adjustment.ratePpm)
  }
  return Math.max(0, 공제액)
}

function 한도전근로소득세액공제(산출세액: number, rates: PayrollRateTable): number {
  const 세액공제기준 = rates.wageIncomeTax.earnedIncomeCredit
  if (산출세액 <= 세액공제기준.threshold) return applyPpm(산출세액, 세액공제기준.lowRatePpm)
  return 세액공제기준.baseAbove + applyPpm(산출세액 - 세액공제기준.threshold, 세액공제기준.highRatePpm)
}

function 근로소득세액공제한도(총급여액: number, rates: PayrollRateTable): number {
  const 한도구간 = rates.wageIncomeTax.earnedIncomeCreditLimits.find(
    (candidate) => candidate.upTo === null || 총급여액 <= candidate.upTo,
  )
  if (한도구간 === undefined) return 0
  return Math.max(
    한도구간.floor,
    한도구간.base - applyPpm(Math.max(0, 총급여액 - 한도구간.over), 한도구간.reductionPpm),
  )
}
