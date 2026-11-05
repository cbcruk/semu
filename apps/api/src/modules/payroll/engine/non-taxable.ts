import { formatWon } from './engine-math.ts'
import type { PaymentItemInput, PaymentLine, PayrollWarning } from './engine.types.ts'
import type { NonTaxableCategory, PayrollRateTable } from './rate-table.types.ts'

/** {@link splitNonTaxable}에 넘기는 직원 정보입니다. */
export interface NonTaxableContext {
  /**
   * 보육수당 비과세 대상 자녀 수(과세기간 개시일 현재 6세 이하)입니다. 보육수당 월 한도는 법정 한도 × 이 값입니다.
   * 없으면 1명으로 보고 `CHILDCARE_CHILDREN_UNKNOWN` 경고를 붙입니다.
   */
  childcareChildren?: number
}

/** {@link splitNonTaxable}의 결과입니다. */
export interface NonTaxableSplit {
  lines: PaymentLine[]
  warnings: PayrollWarning[]
}

/**
 * 지급 항목을 법정·회사 한도 안에서 과세분과 비과세분으로 나눕니다.
 *
 * 한 유형의 한도는 그 유형의 모든 항목이 함께 쓰고, 항목 순서대로 소진합니다. 월 한도는 법정 월 한도와
 * 회사 한도 중 작은 값이고, 연 한도는 `annualNonTaxableUsed`를 뺀 나머지입니다. 한도를 넘는 금액은
 * 과세로 바꾸고 `NON_TAXABLE_LIMIT_EXCEEDED` 경고를 붙입니다. 어느 한도도 없는 유형은 전액 비과세입니다.
 *
 * 보육수당(`CHILDCARE`)의 법정 월 한도는 자녀 1명당 한도라 `context.childcareChildren`을 곱합니다(소득세법
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
  const remaining = new Map<NonTaxableCategory, number>()
  const warnings: PayrollWarning[] = []
  const childcareChildren = context.childcareChildren ?? 1
  if (
    context.childcareChildren === undefined &&
    items.some(
      (item) => item.nonTaxableCategory === 'CHILDCARE' && item.preclassifiedNonTaxable !== true && item.amount > 0,
    )
  ) {
    warnings.push({
      code: 'CHILDCARE_CHILDREN_UNKNOWN',
      message: 'The number of children aged 6 or under is unknown; the childcare limit assumes one child.',
    })
  }
  const lines = items.map((item): PaymentLine => {
    const category = item.nonTaxableCategory
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
    if (category === undefined || item.amount <= 0) {
      return {
        code: item.code,
        name: item.name,
        amount: item.amount,
        taxableAmount: item.amount,
        nonTaxableAmount: 0,
        formula: `${formatWon(item.amount)} (과세)`,
      }
    }
    const left = remaining.get(category) ?? initialLimit(item, category, rates, childcareChildren)
    const nonTaxableAmount = Math.min(item.amount, left)
    remaining.set(category, left - nonTaxableAmount)
    const taxableAmount = item.amount - nonTaxableAmount
    if (taxableAmount > 0) {
      warnings.push({
        code: 'NON_TAXABLE_LIMIT_EXCEEDED',
        message: `${item.name}: ${formatWon(taxableAmount)} won over the non-taxable limit is taxed.`,
      })
    }
    const limitText = Number.isFinite(left) ? `한도 ${formatWon(left)}` : '한도 없음'
    return {
      code: item.code,
      name: item.name,
      amount: item.amount,
      taxableAmount,
      nonTaxableAmount,
      formula: `비과세 ${formatWon(nonTaxableAmount)} (${limitText}), 과세 ${formatWon(taxableAmount)}`,
    }
  })
  return { lines, warnings }
}

/** 비과세 유형의 법정 월 한도입니다. 없으면 `null`입니다. 보육수당은 자녀 1명당 한도입니다. */
export function statutoryMonthlyLimit(category: NonTaxableCategory, rates: PayrollRateTable): number | null {
  return rates.nonTaxable[category].monthlyLimit
}

function initialLimit(
  item: PaymentItemInput,
  category: NonTaxableCategory,
  rates: PayrollRateTable,
  childcareChildren: number,
): number {
  const statutory = rates.nonTaxable[category]
  const candidates: number[] = []
  if (statutory.monthlyLimit !== null) {
    candidates.push(category === 'CHILDCARE' ? statutory.monthlyLimit * childcareChildren : statutory.monthlyLimit)
  }
  if (statutory.annualLimit !== null) {
    candidates.push(Math.max(0, statutory.annualLimit - (item.annualNonTaxableUsed ?? 0)))
  }
  if (item.companyNonTaxableLimit !== undefined) candidates.push(item.companyNonTaxableLimit)
  return candidates.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...candidates)
}
