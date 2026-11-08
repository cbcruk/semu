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
  const 퇴직일 = addDays(lastWorkDate, 1)
  return daysBetween(addMonthsToDate(퇴직일, -3), 퇴직일)
}

/**
 * 퇴직금에 대한 퇴직소득세를 계산합니다.
 *
 * 단계: 근속연수(1년 미만 끝수는 올림) → 근속연수공제 → 환산급여 `(퇴직소득 − 근속연수공제) × 12 ÷ 근속연수` →
 * 환산급여공제 → 기본세율 → `× 근속연수 ÷ 12`를 10원 미만 절사. 지방소득세는 10%입니다. 공제표는 소득세법 제48조제1항
 * 원문으로 확인했습니다. IRP 과세이연은 범위 밖입니다.
 */
export function retirementIncomeTax(
  severancePay: number,
  serviceDays: number,
  rates: PayrollRateTable,
): RetirementIncomeTaxResult {
  const 퇴직소득세기준 = rates.retirementIncomeTax
  const 근속연수 = Math.max(1, Math.ceil(serviceDays / 365))
  const 근속연수공제 = Math.min(evaluatePerUnit(퇴직소득세기준.serviceYearDeduction, 근속연수), severancePay)
  const 환산급여 = mulDiv(severancePay - 근속연수공제, 12, 근속연수)
  const 환산급여공제 = Math.min(evaluateLinear(퇴직소득세기준.convertedPayDeduction, 환산급여), 환산급여)
  const 과세표준 = 환산급여 - 환산급여공제
  const 환산산출세액 = progressiveTax(과세표준, rates)
  const 퇴직소득세 = truncateTo(mulDiv(환산산출세액, 근속연수, 12), rates.wageIncomeTax.taxRoundingUnit)
  return {
    serviceYears: 근속연수,
    serviceYearDeduction: 근속연수공제,
    convertedPay: 환산급여,
    convertedPayDeduction: 환산급여공제,
    taxBase: 과세표준,
    incomeTax: 퇴직소득세,
    localIncomeTax: localIncomeTaxOf(퇴직소득세, rates),
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
  const 재직일수 = daysBetween(input.joinDate, input.lastWorkDate) + 1
  const 산정기간일수 = input.threeMonthDays ?? averageWagePeriodDays(input.lastWorkDate)
  const 임금총액 =
    input.threeMonthWages + mulDiv(input.annualBonus ?? 0, 3, 12) + mulDiv(input.annualLeavePay ?? 0, 3, 12)
  const 평균임금 = mulDiv(임금총액, 1, 산정기간일수)
  const 통상임금적용인가 = input.ordinaryDailyWage !== undefined && input.ordinaryDailyWage * 산정기간일수 > 임금총액
  const 퇴직금대상인가 = 재직일수 >= 365
  const 퇴직금 = !퇴직금대상인가
    ? 0
    : 통상임금적용인가
      ? mulDiv((input.ordinaryDailyWage ?? 0) * 30, 재직일수, 365)
      : mulDiv(임금총액 * 30, 재직일수, 산정기간일수 * 365)
  const 퇴직소득세계산 = retirementIncomeTax(퇴직금, 재직일수, rates)
  const 퇴직소득세 = 퇴직금대상인가 ? 퇴직소득세계산.incomeTax : 0
  const 지방소득세 = 퇴직금대상인가 ? 퇴직소득세계산.localIncomeTax : 0
  const breakdown: TraceEntry[] = [
    {
      code: 'AVERAGE_DAILY_WAGE',
      label: 통상임금적용인가 ? '통상임금(일)' : '평균임금(일)',
      amount: 통상임금적용인가 ? (input.ordinaryDailyWage ?? 0) : 평균임금,
      formula: `${formatWon(임금총액)} ÷ ${산정기간일수}일`,
    },
    {
      code: 'SEVERANCE_PAY',
      label: '퇴직금',
      amount: 퇴직금,
      formula: `평균임금 × 30 × ${재직일수}일 ÷ 365`,
    },
    {
      code: 'RETIREMENT_INCOME_TAX',
      label: '퇴직소득세',
      amount: 퇴직소득세,
      formula: `근속 ${퇴직소득세계산.serviceYears}년, 환산급여 ${formatWon(퇴직소득세계산.convertedPay)} − 공제 ${formatWon(퇴직소득세계산.convertedPayDeduction)} → 과세표준 ${formatWon(퇴직소득세계산.taxBase)}`,
    },
    {
      code: 'LOCAL_INCOME_TAX',
      label: '지방소득세',
      amount: 지방소득세,
      formula: `퇴직소득세 ${formatWon(퇴직소득세)} × 10%`,
    },
  ]
  return {
    eligible: 퇴직금대상인가,
    serviceDays: 재직일수,
    averageDailyWage: 통상임금적용인가 ? (input.ordinaryDailyWage ?? 0) : 평균임금,
    usedOrdinaryWage: 통상임금적용인가,
    severancePay: 퇴직금,
    retirementIncomeTax: 퇴직소득세,
    localIncomeTax: 지방소득세,
    netPay: 퇴직금 - 퇴직소득세 - 지방소득세,
    breakdown,
  }
}
