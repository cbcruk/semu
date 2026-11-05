import type { PaymentItemInput, PaymentLine, PayrollWarning } from './engine.types'
import { formatWon } from './engine.utils'
import type { NonTaxableCategory, PayrollRateTable } from './rate-table.types'

/** Result of {@linkcode splitNonTaxable}. */
export interface NonTaxableSplit {
  lines: PaymentLine[]
  warnings: PayrollWarning[]
}

/**
 * Splits payment items into taxable and non-taxable parts under the statutory and company limits.
 *
 * The limit of a category is shared by every item in it and consumed in item
 * order. The effective monthly limit is the smaller of the statutory monthly
 * limit and the company limit; annual limits subtract `annualNonTaxableUsed`.
 * Amounts over the limit become taxable (4.6절). A category with neither limit
 * is fully non-taxable.
 *
 * @example Meal allowance over the cap
 * ```ts
 * import { splitNonTaxable } from './non-taxable'
 * import { RATES_2026_01 } from './rate-table-2026'
 *
 * splitNonTaxable([{ code: 'meal', name: '식대', amount: 250_000, nonTaxableCategory: 'meal' }], RATES_2026_01)
 *   .lines[0] // { taxableAmount: 50_000, nonTaxableAmount: 200_000, ... }
 * ```
 */
export function splitNonTaxable(items: readonly PaymentItemInput[], rates: PayrollRateTable): NonTaxableSplit {
  const remaining = new Map<NonTaxableCategory, number>()
  const warnings: PayrollWarning[] = []
  const lines = items.map((item): PaymentLine => {
    const category = item.nonTaxableCategory
    if (item.preclassifiedNonTaxable === true && item.amount > 0) {
      return { code: item.code, name: item.name, amount: item.amount, taxableAmount: 0, nonTaxableAmount: item.amount, formula: `비과세 ${formatWon(item.amount)}` }
    }
    if (category === undefined || item.amount <= 0) {
      return { code: item.code, name: item.name, amount: item.amount, taxableAmount: item.amount, nonTaxableAmount: 0, formula: `${formatWon(item.amount)} (과세)` }
    }
    const left = remaining.get(category) ?? initialLimit(item, category, rates)
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

/** Returns the statutory monthly non-taxable limit of a category, or `null` when it has none. */
export function statutoryMonthlyLimit(category: NonTaxableCategory, rates: PayrollRateTable): number | null {
  return rates.nonTaxable[category].monthlyLimit
}

function initialLimit(item: PaymentItemInput, category: NonTaxableCategory, rates: PayrollRateTable): number {
  const statutory = rates.nonTaxable[category]
  const candidates: number[] = []
  if (statutory.monthlyLimit !== null) candidates.push(statutory.monthlyLimit)
  if (statutory.annualLimit !== null) candidates.push(Math.max(0, statutory.annualLimit - (item.annualNonTaxableUsed ?? 0)))
  if (item.companyNonTaxableLimit !== undefined) candidates.push(item.companyNonTaxableLimit)
  return candidates.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...candidates)
}
