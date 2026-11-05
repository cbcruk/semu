import type { NumberedPage, PlBaseSection, PlSection } from './settlement.types'

/** Profit and loss sections in the fixed wire order. */
export const PL_SECTIONS: readonly PlSection[] = ['매출액', '매출원가', '매출총이익', '판매비와관리비', '영업이익', '영업외수익', '영업외비용', '법인세등', '당기순이익']

/** Sections an upload supplies; 매출총이익, 영업이익 and 당기순이익 are derived from them. */
export const PL_BASE_SECTIONS = ['매출액', '매출원가', '판매비와관리비', '영업외수익', '영업외비용', '법인세등'] as const satisfies readonly PlBaseSection[]

/** Cost sections of the cost analysis, in display order. */
export const COST_SECTIONS: readonly PlSection[] = ['매출원가', '판매비와관리비', '영업외비용', '법인세등']

/**
 * 판매비와관리비 accounts counted as labor cost when computing the welfare usage rate.
 *
 * The spec only names some of them; adjust once the ERP chart of accounts is confirmed.
 */
export const LABOR_COST_ACCOUNTS: readonly string[] = ['직원급여', '임원급여', '급여', '상여금', '제수당', '잡급', '퇴직급여']

/** Baseline welfare usage rate the cost analysis draws, in percent. */
export const WELFARE_BASELINE_PERCENT = '20.00'

/** Top-level balance sheet subjects and their fixed children, in table order. */
export const BS_SUBJECT_ORDER: readonly { subject: string; children: readonly string[] }[] = [
  { subject: '자산', children: ['Ⅰ.유동자산', 'Ⅱ.비유동자산'] },
  { subject: '부채', children: ['Ⅰ.유동부채', 'Ⅱ.비유동부채'] },
  { subject: '자본', children: ['Ⅰ.자본금', 'Ⅱ.자본잉여금', 'Ⅲ.자본조정', 'Ⅳ.기타포괄손익누계액', 'Ⅴ.이익잉여금'] },
  { subject: '부채와자본', children: [] },
]

/** Financial ratio names of the balance sheet chart, sent verbatim. */
export const BS_CHART_NAMES = [
  '자기자본비율',
  '부채비율',
  '유동비율',
  '총자본순이익률',
  '자기자본순이익률',
  '총자산회전율',
  '재고자산회전율',
  '매출채권회전율',
] as const

/** Page size of the page-number partner lists. */
export const PARTNER_PAGE_SIZE = 20

/**
 * Formats `numerator / denominator × scale` with two decimals.
 *
 * @returns The ratio such as `"12.34"`, or `null` when the denominator is zero.
 */
export function formatRatio(numerator: number, denominator: number, scale = 100): string | null {
  if (denominator === 0) return null
  return ((numerator / denominator) * scale).toFixed(2)
}

/** Formats an ISO 8601 instant with offset as the `YYYY-MM-DD HH:mm:ss` wall time it carries. */
export function formatWallTime(isoInstant: string): string {
  return isoInstant.slice(0, 19).replace('T', ' ')
}

/** Returns `YYYYMM` month keys from January of `fromYear` through `toMonth` of `toYear`. */
export function monthKeys(fromYear: number, toYear: number, toMonth: number): string[] {
  const keys: string[] = []
  for (let year = fromYear; year <= toYear; year++) {
    const last = year === toYear ? toMonth : 12
    for (let month = 1; month <= last; month++) keys.push(`${year}${String(month).padStart(2, '0')}`)
  }
  return keys
}

/**
 * Wraps one page of results in a page-number DRF envelope.
 *
 * @param requestUrl The current request URL; `next` and `previous` replace its `page` parameter.
 */
export function toNumberedPage<T>(all: readonly T[], page: number, pageSize: number, requestUrl: string): NumberedPage<T> {
  const link = (target: number): string => {
    const url = new URL(requestUrl)
    url.searchParams.set('page', String(target))
    return url.toString()
  }
  const start = (page - 1) * pageSize
  return {
    count: all.length,
    next: start + pageSize < all.length ? link(page + 1) : null,
    previous: page > 1 ? link(page - 1) : null,
    results: all.slice(start, start + pageSize),
  }
}

/** Escapes one CSV field per RFC 4180. */
export function csvField(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Serializes rows as CSV with a UTF-8 byte order mark so spreadsheet apps detect Korean text. */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return `﻿${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`
}
