import { mulDiv } from './engine-math.ts'
import type { PremiumMultipliers, ProrationInput } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'

/**
 * `perMinutes`분에 `amount`원인 임금 단가입니다. 통상시급을 반올림하지 않고 가산수당을 계산하려고 분수로 둡니다.
 *
 * 월급은 `{ amount: 통상임금 월액, perMinutes: 209 × 60 }`, 시급은 `{ amount: 시급, perMinutes: 60 }`입니다.
 */
export interface WageRate {
  amount: number
  perMinutes: number
}

/** 1일 주휴시간을 주 소정근로시간에서 구하는 방법입니다. 비례식(`PROPORTIONAL`) 또는 소정근로일수로 나눔(`PER_DAY`)입니다. */
export type WeeklyRestMethod = 'PROPORTIONAL' | 'PER_DAY'

/** 5인 이상 사업장의 기본 지급배수입니다. 연장 1.5, 야간 0.5(가산분), 휴일 1.5, 휴일연장 2입니다. */
export const MULTIPLIERS_FIVE_OR_MORE: PremiumMultipliers = {
  overtimeRatePpm: 1_500_000,
  nightRatePpm: 500_000,
  holidayRatePpm: 1_500_000,
  holidayOvertimeRatePpm: 2_000_000,
}

/** 5인 미만 사업장의 기본 지급배수입니다. 근로기준법 제56조를 적용받지 않아 가산이 없습니다. */
export const MULTIPLIERS_UNDER_FIVE: PremiumMultipliers = {
  overtimeRatePpm: 1_000_000,
  nightRatePpm: 0,
  holidayRatePpm: 1_000_000,
  holidayOvertimeRatePpm: 1_000_000,
}

/** 사업장 규모에 맞는 기본 지급배수입니다. */
export function defaultMultipliers(underFiveEmployees: boolean): PremiumMultipliers {
  return underFiveEmployees ? MULTIPLIERS_UNDER_FIVE : MULTIPLIERS_FIVE_OR_MORE
}

/**
 * 주 소정근로시간(분)에서 1일 주휴시간(분)을 구합니다.
 *
 * 주 15시간 미만이면 0입니다. `PROPORTIONAL`(기본)은 `주 소정 ÷ 40 × 8`로 단시간 근로자 비례식이고,
 * `PER_DAY`는 `주 소정 ÷ 소정근로일수`입니다. 둘 다 8시간이 상한이고 주 5일이면 같습니다. 분 단위로 반올림합니다.
 */
export function weeklyRestMinutes(
  weeklyMinutes: number,
  options: { method?: WeeklyRestMethod; workDaysPerWeek?: number } = {},
): number {
  if (weeklyMinutes < 15 * 60) return 0
  const 상한전주휴분 =
    options.method === 'PER_DAY' ? weeklyMinutes / Math.max(1, options.workDaysPerWeek ?? 5) : weeklyMinutes / 5
  return Math.round(Math.min(8 * 60, 상한전주휴분))
}

/**
 * 유급 주휴를 포함한 월 소정근로시간입니다. `(주 소정 + 주휴) × 365 ÷ 7 ÷ 12`를 시간 단위로 반올림합니다.
 *
 * @example 주 40시간
 * ```ts
 * monthlyStandardHours(40 * 60, 8 * 60) // 209
 * ```
 */
export function monthlyStandardHours(weeklyMinutes: number, restMinutes: number): number {
  return Math.round(((weeklyMinutes + restMinutes) * 365) / (84 * 60))
}

/** 월 통상임금을 월 소정근로시간으로 나눈 {@link WageRate}입니다. */
export function monthlyWageRate(monthlyOrdinaryPay: number, standardHours: number): WageRate {
  return { amount: monthlyOrdinaryPay, perMinutes: standardHours * 60 }
}

/** 단가의 통상시급입니다. 원 미만 절사입니다. */
export function hourlyRateOf(rate: WageRate): number {
  return mulDiv(rate.amount, 60, rate.perMinutes)
}

/**
 * `minutes`분을 단가의 `multiplierPpm`배로 지급합니다. 원 미만 절사입니다.
 *
 * 연장·휴일 배수는 기본 시간을 포함한 값(1.5)이고, 야간은 가산분(0.5)입니다. 급여 설정의 값을 씁니다.
 *
 * @example 시급 12,000원으로 연장 10시간, 5인 이상
 * ```ts
 * premiumPay({ amount: 12_000, perMinutes: 60 }, 600, 1_500_000) // 180_000
 * ```
 */
export function premiumPay(rate: WageRate, minutes: number, multiplierPpm: number): number {
  if (minutes <= 0 || multiplierPpm <= 0) return 0
  return mulDiv(rate.amount, minutes * multiplierPpm, rate.perMinutes * 1_000_000)
}

/** 분을 단가대로 지급합니다(배수 1). */
export function payForMinutes(rate: WageRate, minutes: number): number {
  return premiumPay(rate, minutes, 1_000_000)
}

/**
 * 월 금액을 일할계산합니다. 원 미만 절사입니다.
 *
 * `CALENDAR_DAYS`는 그 달 역일수로, `SCHEDULED_DAYS`는 소정근로일수로 나눕니다.
 */
export function prorate(amount: number, proration: ProrationInput): number {
  if (proration.totalDays <= 0) return amount
  const 지급일수 = Math.min(Math.max(0, proration.payableDays), proration.totalDays)
  return mulDiv(amount, 지급일수, proration.totalDays)
}

/** 시급제·일급제의 주휴수당입니다. `통상시급 × 1일 주휴시간 × 개근 주 수`입니다. */
export function weeklyHolidayAllowance(rate: WageRate, dailyRestMinutes: number, weeks: number): number {
  return payForMinutes(rate, dailyRestMinutes * Math.max(0, weeks))
}

/** 일용근로자가 국민연금·건강보험 가입 대상인지입니다. 월 8일 이상 또는 60시간 이상입니다. */
export function dailyWorkerSocialInsuranceRequired(
  workDays: number,
  totalMinutes: number,
  rates: PayrollRateTable,
): boolean {
  return (
    workDays >= rates.dailyWorker.socialInsuranceMinDays ||
    totalMinutes >= rates.dailyWorker.socialInsuranceMinHours * 60
  )
}

/** 시간당 환산액이 최저시급보다 낮은지입니다. */
export function isBelowMinimumWage(rate: WageRate, rates: PayrollRateTable): boolean {
  return rate.amount * 60 < rates.minimumWage.hourly * rate.perMinutes
}
