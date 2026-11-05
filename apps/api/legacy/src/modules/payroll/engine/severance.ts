import { addDays, addMonths, daysBetween } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { SeveranceInput, SeveranceResult, TraceEntry } from './engine.types'
import { evaluateLinear, evaluatePerUnit, formatWon, mulDiv, truncateTo } from './engine.utils'
import type { PayrollRateTable } from './rate-table.types'
import { localIncomeTaxOf, progressiveTax } from './wage-income-tax'

/** Result of {@linkcode retirementIncomeTax}. */
export interface RetirementIncomeTaxResult {
  serviceYears: number
  serviceYearDeduction: number
  convertedPay: number
  convertedPayDeduction: number
  taxBase: number
  incomeTax: number
  localIncomeTax: number
}

/** Counts the days of the 평균임금 period: the three calendar months before the retirement date (the day after the last work day). */
export function averageWagePeriodDays(lastWorkDate: PlainDate): number {
  const retirementDate = addDays(lastWorkDate, 1)
  return daysBetween(addMonths(retirementDate, -3), retirementDate)
}

/**
 * Computes 퇴직소득세 on a severance payment.
 *
 * Steps: 근속연수 (partial years round up) → 근속연수공제 → 환산급여
 * `(퇴직소득 − 근속연수공제) × 12 ÷ 근속연수` → 환산급여공제 → progressive rates
 * → `× 근속연수 ÷ 12`, truncated below 10 won. Local income tax is 10%. The
 * coefficients are unverified (spec 4.11) and IRP deferral is out of scope.
 */
export function retirementIncomeTax(severancePay: number, serviceDays: number, rates: PayrollRateTable): RetirementIncomeTaxResult {
  const table = rates.retirementIncomeTax
  const serviceYears = Math.max(1, Math.ceil(serviceDays / 365))
  const serviceYearDeduction = Math.min(evaluatePerUnit(table.serviceYearDeduction, serviceYears), severancePay)
  const convertedPay = mulDiv(severancePay - serviceYearDeduction, 12, serviceYears)
  const convertedPayDeduction = Math.min(evaluateLinear(table.convertedPayDeduction, convertedPay), convertedPay)
  const taxBase = convertedPay - convertedPayDeduction
  const incomeTax = truncateTo(mulDiv(progressiveTax(taxBase, rates), serviceYears, 12), rates.wageIncomeTax.taxRoundingUnit)
  return {
    serviceYears,
    serviceYearDeduction,
    convertedPay,
    convertedPayDeduction,
    taxBase,
    incomeTax,
    localIncomeTax: localIncomeTaxOf(incomeTax, rates),
  }
}

/**
 * Calculates statutory severance pay (퇴직금) and its retirement income tax.
 *
 * `평균임금(일) = (3개월 임금 + 연간 상여 × 3/12 + 연차수당 × 3/12) ÷ 3개월 역일수`,
 * replaced by 통상임금(일) when that is higher. `퇴직금 = 평균임금 × 30 × 재직일수 ÷ 365`,
 * computed from the exact fraction and truncated once to whole won. The
 * average daily wage is reported truncated to whole won. Service under one
 * year (365 days, counting both the join date and the last work day) is not
 * eligible and pays zero.
 *
 * @example Three years less two months at 3,000,000 won a month
 * ```ts
 * import { calculateSeverancePay } from './severance'
 * import { RATES_2026_07 } from './rate-table-2026'
 * import { toPlainDate } from '../../../lib/plain-date'
 *
 * calculateSeverancePay(
 *   { joinDate: toPlainDate('2024-01-01'), lastWorkDate: toPlainDate('2026-10-31'), threeMonthWages: 9_000_000 },
 *   RATES_2026_07,
 * ).severancePay // 8_321_917
 * ```
 */
export function calculateSeverancePay(input: SeveranceInput, rates: PayrollRateTable): SeveranceResult {
  const serviceDays = daysBetween(input.joinDate, input.lastWorkDate) + 1
  const periodDays = input.threeMonthDays ?? averageWagePeriodDays(input.lastWorkDate)
  const wageTotal = input.threeMonthWages + mulDiv(input.annualBonus ?? 0, 3, 12) + mulDiv(input.annualLeavePay ?? 0, 3, 12)
  const averageDaily = mulDiv(wageTotal, 1, periodDays)
  const usedOrdinaryWage = input.ordinaryDailyWage !== undefined && input.ordinaryDailyWage * periodDays > wageTotal
  const eligible = serviceDays >= 365
  const severancePay = !eligible
    ? 0
    : usedOrdinaryWage
      ? mulDiv((input.ordinaryDailyWage ?? 0) * 30, serviceDays, 365)
      : mulDiv(wageTotal * 30, serviceDays, periodDays * 365)
  const tax = retirementIncomeTax(severancePay, serviceDays, rates)
  const incomeTax = eligible ? tax.incomeTax : 0
  const localIncomeTax = eligible ? tax.localIncomeTax : 0
  const breakdown: TraceEntry[] = [
    {
      code: 'average_daily_wage',
      label: usedOrdinaryWage ? '통상임금(일)' : '평균임금(일)',
      amount: usedOrdinaryWage ? (input.ordinaryDailyWage ?? 0) : averageDaily,
      formula: `${formatWon(wageTotal)} ÷ ${periodDays}일`,
    },
    { code: 'severance_pay', label: '퇴직금', amount: severancePay, formula: `평균임금 × 30 × ${serviceDays}일 ÷ 365` },
    {
      code: 'retirement_income_tax',
      label: '퇴직소득세',
      amount: incomeTax,
      formula: `근속 ${tax.serviceYears}년, 환산급여 ${formatWon(tax.convertedPay)} − 공제 ${formatWon(tax.convertedPayDeduction)} → 과세표준 ${formatWon(tax.taxBase)}`,
    },
    { code: 'local_income_tax', label: '지방소득세', amount: localIncomeTax, formula: `퇴직소득세 ${formatWon(incomeTax)} × 10%` },
  ]
  return {
    eligible,
    serviceDays,
    averageDailyWage: usedOrdinaryWage ? (input.ordinaryDailyWage ?? 0) : averageDaily,
    usedOrdinaryWage,
    severancePay,
    retirementIncomeTax: incomeTax,
    localIncomeTax,
    netPay: severancePay - incomeTax - localIncomeTax,
    breakdown,
  }
}
