import { invalidField } from '../../../lib/domain-error'
import { addDays, addMonths, daysBetween, fromParts, lastDayOfMonth, minDate, quarterOfMonth, toParts } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { PlCategory } from '../account-titles/account-titles.types'
import type { Bucket, PlFigures, PlLine, ReportUnit } from './realtime-reports.types'

/** Presets each unit of 매출·매입 현황 offers, the first being the default. */
export const SALES_PURCHASE_PRESETS: Record<ReportUnit, readonly string[]> = {
  day: ['last_7_days', 'last_30_days', 'custom'],
  month: ['this_year', 'last_3_months', 'last_6_months', 'last_12_months'],
  quarter: ['this_year', 'last_3_years'],
  year: ['last_3_years', 'last_5_years'],
}

/** Presets of 자금 현황 > 기간별 추이. */
export const CASH_PERIOD_PRESETS = ['last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'last_year', 'last_3_years'] as const

/** Earliest date the daily custom range accepts. */
export const CUSTOM_RANGE_FLOOR = '2022-01-01'

/** Longest daily custom range in days. */
export const CUSTOM_RANGE_MAX_DAYS = 31

const INCOME_LINES: ReadonlySet<PlCategory> = new Set(['revenue', 'non_op_income'])

/** Checks whether a profit and loss line counts as income rather than expense. */
export function isIncomeLine(category: PlCategory): boolean {
  return INCOME_LINES.has(category)
}

/** Returns zeroed profit and loss figures. */
export function emptyFigures(): PlFigures {
  return {
    revenue: 0,
    cogs: 0,
    gross_profit: 0,
    sga: 0,
    operating_profit: 0,
    non_op_income: 0,
    non_op_expense: 0,
    income_tax: 0,
    net_income: 0,
    breakdown: { revenue: {}, cogs: {}, sga: {}, non_op_income: {}, non_op_expense: {}, income_tax: {} },
  }
}

/** Adds an amount to one line and its account breakdown. */
export function addToLine(figures: PlFigures, line: PlLine, accountName: string, amount: number): void {
  figures[line] += amount
  figures.breakdown[line][accountName] = (figures.breakdown[line][accountName] ?? 0) + amount
}

/**
 * Fills the derived lines from the base lines.
 *
 * 매출총이익 = 매출 − 매출원가, 영업이익 = 매출총이익 − 판관비,
 * 순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세등.
 */
export function finalizeFigures(figures: PlFigures): PlFigures {
  figures.gross_profit = figures.revenue - figures.cogs
  figures.operating_profit = figures.gross_profit - figures.sga
  figures.net_income = figures.operating_profit + figures.non_op_income - figures.non_op_expense - figures.income_tax
  return figures
}

/** Adds the base lines and breakdowns of `addend` into `target`. */
export function accumulateFigures(target: PlFigures, addend: PlFigures): void {
  for (const line of Object.keys(target.breakdown) as PlLine[]) {
    target[line] += addend[line]
    for (const [name, amount] of Object.entries(addend.breakdown[line])) target.breakdown[line][name] = (target.breakdown[line][name] ?? 0) + amount
  }
}

/**
 * Resolves a 매출·매입 현황 preset into its date range, ending today.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown presets or an invalid custom range.
 */
export function salesPurchaseRange(unit: ReportUnit, preset: string, today: PlainDate, custom: { start?: PlainDate | undefined; end?: PlainDate | undefined }): { start: PlainDate; end: PlainDate } {
  if (!SALES_PURCHASE_PRESETS[unit].includes(preset)) throw invalidField('preset', `Unknown preset for ${unit}.`)
  const { year, month } = toParts(today)
  switch (preset) {
    case 'last_7_days':
      return { start: addDays(today, -6), end: today }
    case 'last_30_days':
      return { start: addDays(today, -29), end: today }
    case 'custom': {
      if (custom.start === undefined || custom.end === undefined) throw invalidField('start', 'Send start and end for a custom range.')
      if (custom.start < CUSTOM_RANGE_FLOOR) throw invalidField('start', `The range starts on ${CUSTOM_RANGE_FLOOR} at the earliest.`)
      if (custom.start > custom.end || daysBetween(custom.start, custom.end) >= CUSTOM_RANGE_MAX_DAYS) {
        throw invalidField('end', `Choose 1 to ${CUSTOM_RANGE_MAX_DAYS} days.`)
      }
      return { start: custom.start, end: custom.end }
    }
    case 'this_year':
      return { start: fromParts(year, 1, 1), end: today }
    case 'last_3_months':
    case 'last_6_months':
    case 'last_12_months':
      return { start: addMonths(fromParts(year, month, 1), -(Number(preset.split('_')[1]) - 1)), end: today }
    case 'last_3_years':
      return unit === 'quarter'
        ? { start: addMonths(fromParts(year, quarterOfMonth(month) * 3 - 2, 1), -33), end: today }
        : { start: fromParts(year - 2, 1, 1), end: today }
    default:
      return { start: fromParts(year - 4, 1, 1), end: today }
  }
}

/**
 * Resolves a 기간별 추이 preset into its date range; ranges that include today end yesterday, when the last scrape ran.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown presets.
 */
export function cashPeriodRange(preset: string, today: PlainDate): { start: PlainDate; end: PlainDate } {
  const { year, month } = toParts(today)
  const yesterday = addDays(today, -1)
  switch (preset) {
    case 'last_3_months':
    case 'last_6_months':
    case 'last_12_months':
      return { start: addMonths(fromParts(year, month, 1), -(Number(preset.split('_')[1]) - 1)), end: yesterday }
    case 'this_year':
      return { start: fromParts(year, 1, 1), end: yesterday }
    case 'last_year':
      return { start: fromParts(year - 1, 1, 1), end: fromParts(year - 1, 12, 31) }
    case 'last_3_years':
      return { start: fromParts(year - 2, 1, 1), end: yesterday }
    default:
      throw invalidField('preset', 'Unknown preset.')
  }
}

/** Splits a range into consecutive buckets of a unit, clipping the first and last to the range. */
export function bucketsOf(unit: ReportUnit, start: PlainDate, end: PlainDate): Bucket[] {
  const buckets: Bucket[] = []
  let cursor = start
  while (cursor <= end) {
    const { year, month } = toParts(cursor)
    let bucketEnd: PlainDate
    let key: string
    if (unit === 'day') {
      bucketEnd = cursor
      key = cursor
    } else if (unit === 'month') {
      bucketEnd = lastDayOfMonth(year, month)
      key = cursor.slice(0, 7)
    } else if (unit === 'quarter') {
      const quarter = quarterOfMonth(month)
      bucketEnd = lastDayOfMonth(year, quarter * 3)
      key = `${year}-Q${quarter}`
    } else {
      bucketEnd = fromParts(year, 12, 31)
      key = String(year)
    }
    const clipped = minDate(bucketEnd, end)
    buckets.push({ key, start: cursor, end: clipped })
    cursor = addDays(bucketEnd, 1)
  }
  return buckets
}

/** Finds the bucket that contains a date by binary search over sorted buckets. */
export function bucketIndexOf(buckets: readonly Bucket[], date: string): number {
  let low = 0
  let high = buckets.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const bucket = buckets[middle]
    if (bucket === undefined) return -1
    if (date < bucket.start) high = middle - 1
    else if (date > bucket.end) low = middle + 1
    else return middle
  }
  return -1
}

/** Shifts a date back one year, mapping 29 February to 28 February. */
export function previousYearOf(date: PlainDate): PlainDate {
  return addMonths(date, -12)
}
