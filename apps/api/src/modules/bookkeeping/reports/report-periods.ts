import { addDays, addMonths, daysBetween, lastDayOfMonth } from '../../../shared/time/calendar.ts'

/** 보고서 버킷 단위입니다. */
export type ReportUnit = 'DAY' | 'MONTH' | 'QUARTER' | 'YEAR'

/** 기간 프리셋입니다. */
export type ReportPreset =
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'CUSTOM'
  | 'THIS_YEAR'
  | 'LAST_3_MONTHS'
  | 'LAST_6_MONTHS'
  | 'LAST_12_MONTHS'
  | 'LAST_3_YEARS'
  | 'LAST_5_YEARS'
  | 'LAST_YEAR'

/** 이름 붙은 날짜 구간입니다. */
export interface Bucket {
  key: string
  start: string
  end: string
}

/** 매출·매입 현황에서 단위별로 고를 수 있는 프리셋입니다. 첫 값이 기본입니다. */
export const SALES_PURCHASE_PRESETS: Record<ReportUnit, ReadonlyArray<ReportPreset>> = {
  DAY: ['LAST_7_DAYS', 'LAST_30_DAYS', 'CUSTOM'],
  MONTH: ['THIS_YEAR', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'LAST_12_MONTHS'],
  QUARTER: ['THIS_YEAR', 'LAST_3_YEARS'],
  YEAR: ['LAST_3_YEARS', 'LAST_5_YEARS'],
}

/** 일 단위 직접 선택의 가장 이른 시작일입니다. */
export const CUSTOM_RANGE_FLOOR = '2022-01-01'

/** 일 단위 직접 선택의 최대 일수입니다. */
export const CUSTOM_RANGE_MAX_DAYS = 31

/** 기간을 정하지 못한 이유입니다. */
export type PeriodProblem = 'PRESET_NOT_ALLOWED' | 'CUSTOM_RANGE_REQUIRED' | 'CUSTOM_RANGE_INVALID'

type Range = { ok: true; start: string; end: string } | { ok: false; code: PeriodProblem }

/** 매출·매입 현황 프리셋을 오늘로 끝나는 기간으로 풉니다. */
export function salesPurchaseRange(
  unit: ReportUnit,
  preset: ReportPreset,
  today: string,
  custom: { start?: string; end?: string },
): Range {
  if (!SALES_PURCHASE_PRESETS[unit].includes(preset)) return { ok: false, code: 'PRESET_NOT_ALLOWED' }
  const month = today.slice(0, 7)
  switch (preset) {
    case 'LAST_7_DAYS':
      return { ok: true, start: addDays(today, -6), end: today }
    case 'LAST_30_DAYS':
      return { ok: true, start: addDays(today, -29), end: today }
    case 'CUSTOM': {
      if (custom.start === undefined || custom.end === undefined) return { ok: false, code: 'CUSTOM_RANGE_REQUIRED' }
      if (
        custom.start < CUSTOM_RANGE_FLOOR ||
        custom.start > custom.end ||
        daysBetween(custom.start, custom.end) >= CUSTOM_RANGE_MAX_DAYS
      ) {
        return { ok: false, code: 'CUSTOM_RANGE_INVALID' }
      }
      return { ok: true, start: custom.start, end: custom.end }
    }
    case 'THIS_YEAR':
      return { ok: true, start: `${today.slice(0, 4)}-01-01`, end: today }
    case 'LAST_3_MONTHS':
    case 'LAST_6_MONTHS':
    case 'LAST_12_MONTHS':
      return { ok: true, start: `${addMonths(month, -(monthsOf(preset) - 1))}-01`, end: today }
    case 'LAST_3_YEARS':
      return unit === 'QUARTER'
        ? { ok: true, start: `${addMonths(quarterStartMonth(month), -33)}-01`, end: today }
        : { ok: true, start: `${Number(today.slice(0, 4)) - 2}-01-01`, end: today }
    default:
      return { ok: true, start: `${Number(today.slice(0, 4)) - 4}-01-01`, end: today }
  }
}

/** 자금 기간별 추이 프리셋입니다. 오늘을 포함하는 기간은 마지막 수집이 끝난 어제까지입니다. */
export function cashTrendRange(preset: ReportPreset, today: string): Range {
  const year = Number(today.slice(0, 4))
  const yesterday = addDays(today, -1)
  switch (preset) {
    case 'LAST_3_MONTHS':
    case 'LAST_6_MONTHS':
    case 'LAST_12_MONTHS':
      return { ok: true, start: `${addMonths(today.slice(0, 7), -(monthsOf(preset) - 1))}-01`, end: yesterday }
    case 'THIS_YEAR':
      return { ok: true, start: `${year}-01-01`, end: yesterday }
    case 'LAST_YEAR':
      return { ok: true, start: `${year - 1}-01-01`, end: `${year - 1}-12-31` }
    case 'LAST_3_YEARS':
      return { ok: true, start: `${year - 2}-01-01`, end: yesterday }
    default:
      return { ok: false, code: 'PRESET_NOT_ALLOWED' }
  }
}

/** 기간을 단위 버킷으로 자릅니다. 첫·끝 버킷은 기간에 맞춰 자릅니다. */
export function bucketsOf(unit: ReportUnit, start: string, end: string): Bucket[] {
  const buckets: Bucket[] = []
  let cursor = start
  while (cursor <= end) {
    const month = cursor.slice(0, 7)
    let bucketEnd: string
    let key: string
    if (unit === 'DAY') {
      bucketEnd = cursor
      key = cursor
    } else if (unit === 'MONTH') {
      bucketEnd = lastDayOfMonth(month)
      key = month
    } else if (unit === 'QUARTER') {
      const quarter = Math.ceil(Number(month.slice(5)) / 3)
      bucketEnd = lastDayOfMonth(`${month.slice(0, 4)}-${String(quarter * 3).padStart(2, '0')}`)
      key = `${month.slice(0, 4)}-Q${quarter}`
    } else {
      bucketEnd = `${month.slice(0, 4)}-12-31`
      key = month.slice(0, 4)
    }
    buckets.push({ key, start: cursor, end: bucketEnd < end ? bucketEnd : end })
    cursor = addDays(bucketEnd, 1)
  }
  return buckets
}

/** 날짜가 든 버킷의 위치입니다. 없으면 -1입니다. */
export function bucketIndexOf(buckets: ReadonlyArray<Bucket>, date: string): number {
  return buckets.findIndex((bucket) => bucket.start <= date && date <= bucket.end)
}

/** 1년 전 같은 날입니다. 2월 29일은 2월 28일이 됩니다. */
export function previousYearOf(date: string): string {
  const month = addMonths(date.slice(0, 7), -12)
  const last = lastDayOfMonth(month)
  const day = `${month}-${date.slice(8, 10)}`
  return day > last ? last : day
}

function monthsOf(preset: ReportPreset): number {
  return Number(preset.split('_')[1])
}

function quarterStartMonth(month: string): string {
  const quarter = Math.ceil(Number(month.slice(5)) / 3)
  return `${month.slice(0, 4)}-${String(quarter * 3 - 2).padStart(2, '0')}`
}
