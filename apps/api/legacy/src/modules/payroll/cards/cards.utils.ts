import { addDays, addMonths, daysInMonth, fromParts } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { PayrollIncomeType } from '../engine/engine.types'
import type { YearMonth } from '../engine/rate-table.types'
import type { PayrollTermsRow } from '../settings/settings.types'
import type { BpoSegment, LegacySegment, PayslipGroup, WorkInfo } from './cards.types'

/** Every BPO income segment, in tab order. */
export const BPO_SEGMENTS: readonly BpoSegment[] = ['wage-monthly', 'wage-daily', 'wage-hourly', 'daily', 'business', 'other']

/** BPO segments with the full wage input toolset (spec 5.4). */
export const WAGE_SEGMENTS: readonly BpoSegment[] = ['wage-monthly', 'wage-daily', 'wage-hourly']

/** BPO segments with the simple input toolset (spec 5.6). */
export const SIMPLE_SEGMENTS: readonly BpoSegment[] = ['daily', 'business', 'other']

/** Income types entered as wage income (근로소득). */
export const WAGE_INCOME_TYPES: readonly PayrollIncomeType[] = ['wage_monthly', 'wage_daily', 'wage_hourly']

/** An empty work sheet. */
export const EMPTY_WORK: WorkInfo = {
  regular_hours: 0,
  overtime_hours: 0,
  night_hours: 0,
  holiday_hours: 0,
  holiday_overtime_hours: 0,
  absence_hours: 0,
  weekly_holiday_deduction_days: 0,
  weekly_holiday_weeks: 0,
}

/** Parses a URL segment into a BPO segment, or `undefined` when it is not one. */
export function parseBpoSegment(value: string): BpoSegment | undefined {
  return (BPO_SEGMENTS as readonly string[]).includes(value) ? (value as BpoSegment) : undefined
}

/** Converts a BPO segment to the engine income type (`wage-monthly` → `wage_monthly`). */
export function incomeTypeOfSegment(segment: BpoSegment): PayrollIncomeType {
  return segment.replace('-', '_') as PayrollIncomeType
}

/** Converts an engine income type back to its BPO segment. */
export function segmentOf(incomeType: PayrollIncomeType): BpoSegment {
  return incomeType.replace('_', '-') as BpoSegment
}

/** Whether an income type is wage income. */
export function isWageIncome(incomeType: PayrollIncomeType): boolean {
  return WAGE_INCOME_TYPES.includes(incomeType)
}

/** Parses a payslip URL group. */
export function parsePayslipGroup(value: string): PayslipGroup | undefined {
  return value === 'wage' || value === 'business' || value === 'daily' || value === 'other' ? value : undefined
}

/** Income types listed under a payslip group. */
export function incomeTypesOfGroup(group: PayslipGroup): PayrollIncomeType[] {
  return group === 'wage' ? [...WAGE_INCOME_TYPES] : [group]
}

/** Payslip group of an income type. */
export function payslipGroupOf(incomeType: PayrollIncomeType): PayslipGroup {
  return isWageIncome(incomeType) ? 'wage' : (incomeType as PayslipGroup)
}

/** Legacy segment of an income type (`other` → `other-labor`, wage → `wage-salary`). */
export function legacySegmentOf(incomeType: PayrollIncomeType): LegacySegment {
  if (isWageIncome(incomeType)) return 'wage-salary'
  return incomeType === 'other' ? 'other-labor' : (incomeType as LegacySegment)
}

/** Parses a legacy `income_type` value, accepting the snake_case payload keys too. */
export function parseLegacySegment(value: string): LegacySegment | undefined {
  const normalized = value.replace('_', '-')
  return normalized === 'wage-salary' || normalized === 'daily' || normalized === 'business' || normalized === 'other-labor' ? normalized : undefined
}

/** Income types covered by a legacy segment. */
export function incomeTypesOfLegacySegment(segment: LegacySegment): PayrollIncomeType[] {
  if (segment === 'wage-salary') return [...WAGE_INCOME_TYPES]
  return [segment === 'other-labor' ? 'other' : segment]
}

/**
 * Computes the default payment date of an attribution month from the payroll terms.
 *
 * `payment_month` picks the month (`previous`, `current` or `next`) and
 * `payment_day` the day, clamped to the month's last day (31 = 말일).
 */
export function defaultPaymentDate(month: YearMonth, terms: Pick<PayrollTermsRow, 'payment_month' | 'payment_day'>): PlainDate {
  const offset = terms.payment_month === 'next' ? 1 : terms.payment_month === 'previous' ? -1 : 0
  return paymentDateIn(addMonths(`${month}-01` as PlainDate, offset).slice(0, 7), terms.payment_day)
}

/** Builds the date of a payment day within a month, clamped to the month's last day. */
export function paymentDateIn(month: YearMonth, day: number): PlainDate {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  return fromParts(year, monthNumber, Math.min(day, daysInMonth(year, monthNumber)))
}

/**
 * Computes the wage period (임금산정 기간) of an attribution month.
 *
 * The period starts on `wage_period_start_day` of the month and lasts one
 * month, so a start day of 1 covers the calendar month.
 */
export function wagePeriodOf(month: YearMonth, startDay: number): { start: PlainDate; end: PlainDate } {
  const start = paymentDateIn(month, startDay)
  return { start, end: addDays(addMonths(start, 1), -1) }
}

/** Payment month (`YYYY-MM`) of a payment date; withholding follows the payment month. */
export function paymentMonthOf(date: PlainDate): YearMonth {
  return date.slice(0, 7)
}

/** Statutory withholding deadline of a payment month: the 10th of the next month. */
export function withholdingDeadlineOf(paymentMonth: YearMonth): PlainDate {
  return fromParts(Number(paymentMonth.slice(0, 4)), Number(paymentMonth.slice(5, 7)) + 1, 10)
}

/** First and last day of a month. */
export function monthBounds(month: YearMonth): { start: PlainDate; end: PlainDate } {
  const start = `${month}-01` as PlainDate
  return { start, end: addDays(addMonths(start, 1), -1) }
}

/** Parses a JSON column, falling back when it is empty. */
export function parseJsonColumn<T>(value: string | null, fallback: T): T {
  return value === null || value === '' ? fallback : (JSON.parse(value) as T)
}
