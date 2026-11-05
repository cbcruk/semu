import type { PremiumMultipliers, ProrationInput } from './engine.types'
import { mulDiv, toHundredths, toMinutes } from './engine.utils'
import type { PayrollRateTable } from './rate-table.types'

/**
 * A wage rate kept as `amount` won per `perMinutes` minutes, so premiums avoid rounding the hourly rate.
 *
 * A monthly salary is `{ amount: 통상임금 월액, perMinutes: 209 × 60 }`; an hourly wage is `{ amount: 시급, perMinutes: 60 }`.
 */
export interface WageRate {
  amount: number
  perMinutes: number
}

/** Premium kinds of {@linkcode premiumPay}. */
export type PremiumKind = keyof PremiumMultipliers

/** How 1일 주휴시간 is derived from the weekly contractual hours. */
export type WeeklyRestMethod = 'proportional' | 'per_day'

/** Default premium multipliers for workplaces with five or more employees (payroll_terms defaults). */
export const MULTIPLIERS_FIVE_OR_MORE: PremiumMultipliers = { overtime: 1.5, night: 0.5, holiday: 1.5, holidayOvertime: 2 }

/** Default premium multipliers for workplaces with fewer than five employees. */
export const MULTIPLIERS_UNDER_FIVE: PremiumMultipliers = { overtime: 1, night: 0, holiday: 1, holidayOvertime: 1 }

/**
 * Computes 1일 주휴시간 from the weekly contractual hours.
 *
 * Below 15 hours a week there is no paid weekly rest. `proportional` (default)
 * is `weekly ÷ 40 × 8`, the rule for part-time workers; `per_day` is
 * `weekly ÷ work days` as the spec notes describe. Both cap at 8 hours and
 * agree for a five-day week.
 */
export function weeklyRestHours(weeklyHours: number, options: { method?: WeeklyRestMethod; workDaysPerWeek?: number } = {}): number {
  if (weeklyHours < 15) return 0
  const raw = options.method === 'per_day' ? weeklyHours / Math.max(1, options.workDaysPerWeek ?? 5) : (weeklyHours / 40) * 8
  return Math.round(Math.min(8, raw) * 100) / 100
}

/**
 * Computes 월 소정근로시간 including paid weekly rest: `(weekly + rest) × 365 ÷ 7 ÷ 12`, rounded to whole hours.
 *
 * @example A 40-hour week
 * ```ts
 * import { monthlyStandardHours } from './working-time'
 *
 * monthlyStandardHours(40, 8) // 209
 * ```
 */
export function monthlyStandardHours(weeklyHours: number, restHours: number): number {
  return Math.round(((weeklyHours + restHours) * 365) / 84)
}

/** Builds the {@linkcode WageRate} of a monthly 통상임금 over the monthly standard hours. */
export function monthlyWageRate(monthlyOrdinaryPay: number, standardHours: number): WageRate {
  return { amount: monthlyOrdinaryPay, perMinutes: toMinutes(standardHours) }
}

/** Returns the 통상시급 of a rate, truncated to whole won. */
export function hourlyRateOf(rate: WageRate): number {
  return mulDiv(rate.amount, 60, rate.perMinutes)
}

/**
 * Pays `hours` of work at `multiplier` times the rate, truncated to whole won.
 *
 * Multipliers are totals for overtime and holiday work (1.5 includes the base
 * hour) and additions for night work (0.5), as configured in payroll terms.
 *
 * @example 10 overtime hours at 12,000 won an hour, five or more employees
 * ```ts
 * import { premiumPay } from './working-time'
 *
 * premiumPay({ amount: 12_000, perMinutes: 60 }, 10, 1.5) // 180_000
 * ```
 */
export function premiumPay(rate: WageRate, hours: number, multiplier: number): number {
  const minutes = toMinutes(hours)
  if (minutes <= 0 || multiplier <= 0) return 0
  return mulDiv(rate.amount, minutes * toHundredths(multiplier), rate.perMinutes * 100)
}

/** Pays plain hours at the rate (`premiumPay` with a multiplier of 1). */
export function payForHours(rate: WageRate, hours: number): number {
  return premiumPay(rate, hours, 1)
}

/**
 * Prorates a monthly amount (일할계산), truncating to whole won.
 *
 * `calendar_days` divides by the days in the month; `scheduled_days` divides by
 * the scheduled work days. Which one the product uses is unconfirmed (8절).
 */
export function prorate(amount: number, proration: ProrationInput): number {
  if (proration.totalDays <= 0) return amount
  const days = Math.min(Math.max(0, proration.payableDays), proration.totalDays)
  return mulDiv(amount, days, proration.totalDays)
}

/** Computes 주휴수당 of hourly or daily workers: `시급 × 1일 주휴시간 × 개근 주 수`. */
export function weeklyHolidayAllowance(rate: WageRate, dailyRestHours: number, weeks: number): number {
  return payForHours(rate, dailyRestHours * Math.max(0, weeks))
}

/** Checks whether a daily worker must join the national pension and health insurance (8+ days or 60+ hours a month). */
export function dailyWorkerSocialInsuranceRequired(workDays: number, totalHours: number, rates: PayrollRateTable): boolean {
  return workDays >= rates.dailyWorker.socialInsuranceMinDays || totalHours >= rates.dailyWorker.socialInsuranceMinHours
}

/** Checks a 통상시급-equivalent against the minimum hourly wage. */
export function isBelowMinimumWage(rate: WageRate, rates: PayrollRateTable): boolean {
  return rate.amount * 60 < rates.minimumWage.hourly * rate.perMinutes
}
