import { formatWon } from './engine-math.ts'
import type { PaymentItemInput, PaymentLine, PayrollWarning } from './engine.types.ts'
import type { NonTaxableCategory, PayrollRateTable } from './rate-table.types.ts'

/** 보육수당 비과세 대상 자녀 수의 상한입니다. HR 설정·행 스냅숏·계산기 입력이 이 값까지만 받습니다. */
export const CHILDCARE_CHILDREN_MAX = 20

/** {@link splitNonTaxable}에 넘기는 직원 정보입니다. */
export interface NonTaxableContext {
  /**
   * 보육수당 비과세 대상 자녀 수(과세기간 개시일 현재 6세 이하)입니다. 기준표가 자녀 1명당 한도(`perChild`)면
   * 법정 월 한도 × 이 값을 씁니다. 없으면 1명으로 보고 `CHILDCARE_CHILDREN_UNKNOWN` 경고를 붙입니다.
   * 음수·정수가 아닌 값은 0명으로 봅니다.
   */
  childcareChildren?: number
  /**
   * 자녀 수를 정한 설정이 계산하는 해와 다른 해의 것인지입니다. `true`면 값은 그대로 쓰고
   * `CHILDCARE_CHILDREN_STALE` 경고를 붙여 다시 확인하게 합니다.
   */
  childcareChildrenStale?: boolean
}

/** {@link splitNonTaxable}의 결과입니다. */
export interface NonTaxableSplit {
  lines: PaymentLine[]
  warnings: PayrollWarning[]
}

/**
 * 지급 항목을 법정·회사 한도 안에서 과세분과 비과세분으로 나눕니다.
 *
 * 법정 한도는 직원 한 명의 유형별 합계 한도입니다. 그 유형의 모든 항목이 함께 쓰고 항목 순서대로 소진합니다.
 * 월 한도는 기준표의 월 한도이고, 연 한도는 첫 항목의 `annualNonTaxableUsed`를 뺀 나머지입니다. 회사 한도
 * (`companyNonTaxableLimit`)는 항목마다 그 항목의 비과세 금액만 막습니다. 한도를 넘는 금액은 과세로 바꾸고
 * `NON_TAXABLE_LIMIT_EXCEEDED` 경고를 붙입니다. 어느 한도도 없는 유형은 전액 비과세입니다.
 *
 * 보육수당(`CHILDCARE`)은 기준표가 자녀 1명당 한도(`perChild`)라 `context.childcareChildren`을 곱합니다(소득세법
 * 제12조제3호머목2), 2026. 1. 1. 이후 지급분). 근로소득 행은 직원·귀속월마다 하나라(`duplicatedWageIncome`)
 * 행 하나의 한도가 곧 직원 한 명의 그달 한도입니다.
 *
 * @example 식대 250,000원
 * ```ts
 * splitNonTaxable([{ code: 'MEAL', name: '식대', amount: 250_000, nonTaxableCategory: 'MEAL' }], RATES_2026_01)
 *   .lines[0] // { taxableAmount: 50_000, nonTaxableAmount: 200_000, ... }
 * ```
 */
export function splitNonTaxable(
  items: readonly PaymentItemInput[],
  rates: PayrollRateTable,
  context: NonTaxableContext = {},
): NonTaxableSplit {
  const 유형별남은한도 = new Map<NonTaxableCategory, number>()
  const warnings: PayrollWarning[] = []
  const 자녀수 = context.childcareChildren === undefined ? 1 : 유효자녀수(context.childcareChildren)
  const 자녀당한도항목이있는가 = items.some(
    (item) =>
      item.nonTaxableCategory !== undefined &&
      rates.nonTaxable[item.nonTaxableCategory].perChild === true &&
      item.preclassifiedNonTaxable !== true &&
      item.amount > 0,
  )
  if (자녀당한도항목이있는가 && context.childcareChildren === undefined) {
    warnings.push({
      code: 'CHILDCARE_CHILDREN_UNKNOWN',
      message: 'The number of children aged 6 or under is unknown; the childcare limit assumes one child.',
    })
  }
  if (자녀당한도항목이있는가 && context.childcareChildren !== undefined && context.childcareChildrenStale === true) {
    warnings.push({
      code: 'CHILDCARE_CHILDREN_STALE',
      message: `The childcare child count (${자녀수}) was set for another tax year; recheck it.`,
    })
  }
  const lines = items.map((item): PaymentLine => {
    const 비과세유형 = item.nonTaxableCategory
    if (item.preclassifiedNonTaxable === true && item.amount > 0) {
      return {
        code: item.code,
        name: item.name,
        amount: item.amount,
        taxableAmount: 0,
        nonTaxableAmount: item.amount,
        formula: `비과세 ${formatWon(item.amount)}`,
      }
    }
    if (비과세유형 === undefined || item.amount <= 0) {
      return {
        code: item.code,
        name: item.name,
        amount: item.amount,
        taxableAmount: item.amount,
        nonTaxableAmount: 0,
        formula: `${formatWon(item.amount)} (과세)`,
      }
    }
    const 남은법정한도 = 유형별남은한도.get(비과세유형) ?? 법정한도(item, 비과세유형, rates, 자녀수)
    const 항목한도 = Math.min(남은법정한도, item.companyNonTaxableLimit ?? Number.POSITIVE_INFINITY)
    const nonTaxableAmount = Math.min(item.amount, 항목한도)
    유형별남은한도.set(비과세유형, 남은법정한도 - nonTaxableAmount)
    const taxableAmount = item.amount - nonTaxableAmount
    if (taxableAmount > 0) {
      warnings.push({
        code: 'NON_TAXABLE_LIMIT_EXCEEDED',
        message: `${item.name}: ${formatWon(taxableAmount)} won over the non-taxable limit is taxed.`,
      })
    }
    const 한도문구 = Number.isFinite(항목한도) ? `한도 ${formatWon(항목한도)}` : '한도 없음'
    return {
      code: item.code,
      name: item.name,
      amount: item.amount,
      taxableAmount,
      nonTaxableAmount,
      formula: `비과세 ${formatWon(nonTaxableAmount)} (${한도문구}), 과세 ${formatWon(taxableAmount)}`,
    }
  })
  return { lines, warnings }
}

/** 비과세 유형의 법정 월 한도입니다. 없으면 `null`입니다. `perChild`면 자녀 1명당 한도입니다. */
export function statutoryMonthlyLimit(category: NonTaxableCategory, rates: PayrollRateTable): number | null {
  return rates.nonTaxable[category].monthlyLimit
}

/** 유형 하나의 남은 법정 한도(직원 한 명의 합계)입니다. 회사 한도는 항목마다 따로 봅니다. */
function 법정한도(
  item: PaymentItemInput,
  비과세유형: NonTaxableCategory,
  rates: PayrollRateTable,
  자녀수: number,
): number {
  const 법정기준 = rates.nonTaxable[비과세유형]
  const 한도후보: number[] = []
  if (법정기준.monthlyLimit !== null) {
    한도후보.push(법정기준.perChild === true ? 법정기준.monthlyLimit * 자녀수 : 법정기준.monthlyLimit)
  }
  if (법정기준.annualLimit !== null) {
    한도후보.push(Math.max(0, 법정기준.annualLimit - (item.annualNonTaxableUsed ?? 0)))
  }
  return 한도후보.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...한도후보)
}

/** 자녀 수를 0 이상 정수로 맞춥니다. 음수·NaN 같은 잘못된 값은 0명입니다. */
function 유효자녀수(자녀수: number): number {
  return Number.isInteger(자녀수) && 자녀수 > 0 ? 자녀수 : 0
}
