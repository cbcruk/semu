import { addDays, addMonths, daysBetween, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import { evaluateLinear, evaluatePerUnit, formatWon, mulDiv, truncateTo } from './engine-math.ts'
import type { SeveranceInput, SeveranceResult, TraceEntry } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'
import { localIncomeTaxOf, progressiveTax } from './wage-income-tax.ts'

/** {@link retirementIncomeTax}의 결과입니다. */
export interface RetirementIncomeTaxResult {
  serviceYears: number
  serviceYearDeduction: number
  convertedPay: number
  convertedPayDeduction: number
  taxBase: number
  incomeTax: number
  localIncomeTax: number
}

/** 날짜에서 `months`달 뒤의 같은 날입니다. 그 달에 없는 날이면 말일입니다. */
export function addMonthsToDate(date: string, months: number): string {
  const month = addMonths(date.slice(0, 7), months)
  const last = lastDayOfMonth(month)
  return date.slice(8, 10) > last.slice(8, 10) ? last : `${month}-${date.slice(8, 10)}`
}

/** 평균임금 산정 기간의 일수입니다. 퇴직일(마지막 근무일 다음 날) 이전 3개 역월입니다. */
export function averageWagePeriodDays(lastWorkDate: string): number {
  const retirementDate = addDays(lastWorkDate, 1)
  return daysBetween(addMonthsToDate(retirementDate, -3), retirementDate)
}

/**
 * 퇴직금에 대한 퇴직소득세를 계산합니다.
 *
 * 단계: 근속연수(1년 미만 끝수는 올림) → 근속연수공제 → 환산급여 `(퇴직소득 − 근속연수공제) × 12 ÷ 근속연수` →
 * 환산급여공제 → 기본세율 → `× 근속연수 ÷ 12`를 10원 미만 절사. 지방소득세는 10%입니다. 공제표는 미확인이고
 * IRP 과세이연은 범위 밖입니다.
 */
export function retirementIncomeTax(
  severancePay: number,
  serviceDays: number,
  rates: PayrollRateTable,
): RetirementIncomeTaxResult {
  const table = rates.retirementIncomeTax
  const serviceYears = Math.max(1, Math.ceil(serviceDays / 365))
  const serviceYearDeduction = Math.min(evaluatePerUnit(table.serviceYearDeduction, serviceYears), severancePay)
  const convertedPay = mulDiv(severancePay - serviceYearDeduction, 12, serviceYears)
  const convertedPayDeduction = Math.min(evaluateLinear(table.convertedPayDeduction, convertedPay), convertedPay)
  const taxBase = convertedPay - convertedPayDeduction
  const incomeTax = truncateTo(
    mulDiv(progressiveTax(taxBase, rates), serviceYears, 12),
    rates.wageIncomeTax.taxRoundingUnit,
  )
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
 * 법정 퇴직금과 퇴직소득세를 계산합니다.
 *
 * `평균임금(일) = (3개월 임금 + 연간 상여 × 3/12 + 연차수당 × 3/12) ÷ 3개월 역일수`이고, 통상임금(일)이 더 높으면
 * 그것을 씁니다. `퇴직금 = 평균임금 × 30 × 재직일수 ÷ 365`를 분수 그대로 계산해 한 번만 원 미만 절사합니다.
 * 표시용 평균임금은 원 미만 절사입니다. 재직일수(입사일과 마지막 근무일 포함)가 365일 미만이면 대상이 아니고 0입니다.
 *
 * @example 월 3,000,000원으로 2년 10개월
 * ```ts
 * calculateSeverancePay(
 *   { joinDate: '2024-01-01', lastWorkDate: '2026-10-31', threeMonthWages: 9_000_000 },
 *   RATES_2026_07,
 * ).severancePay // 8_321_917
 * ```
 */
export function calculateSeverancePay(input: SeveranceInput, rates: PayrollRateTable): SeveranceResult {
  const serviceDays = daysBetween(input.joinDate, input.lastWorkDate) + 1
  const periodDays = input.threeMonthDays ?? averageWagePeriodDays(input.lastWorkDate)
  const wageTotal =
    input.threeMonthWages + mulDiv(input.annualBonus ?? 0, 3, 12) + mulDiv(input.annualLeavePay ?? 0, 3, 12)
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
      code: 'AVERAGE_DAILY_WAGE',
      label: usedOrdinaryWage ? '통상임금(일)' : '평균임금(일)',
      amount: usedOrdinaryWage ? (input.ordinaryDailyWage ?? 0) : averageDaily,
      formula: `${formatWon(wageTotal)} ÷ ${periodDays}일`,
    },
    {
      code: 'SEVERANCE_PAY',
      label: '퇴직금',
      amount: severancePay,
      formula: `평균임금 × 30 × ${serviceDays}일 ÷ 365`,
    },
    {
      code: 'RETIREMENT_INCOME_TAX',
      label: '퇴직소득세',
      amount: incomeTax,
      formula: `근속 ${tax.serviceYears}년, 환산급여 ${formatWon(tax.convertedPay)} − 공제 ${formatWon(tax.convertedPayDeduction)} → 과세표준 ${formatWon(tax.taxBase)}`,
    },
    {
      code: 'LOCAL_INCOME_TAX',
      label: '지방소득세',
      amount: localIncomeTax,
      formula: `퇴직소득세 ${formatWon(incomeTax)} × 10%`,
    },
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
