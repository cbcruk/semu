import type { PayrollRateTable, YearMonth } from './rate-table.types.ts'

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** 문자열이 `YYYY-MM` 형식의 달인지입니다. */
export function isYearMonth(value: string): value is YearMonth {
  return YEAR_MONTH.test(value)
}

/**
 * 한 달에 적용하는 기준표를 고릅니다. `effectiveFrom`이 그 달 이하인 것 중 가장 최근 것입니다.
 *
 * @throws {RangeError} 그 달 이전에 시작한 기준표가 없을 때
 *
 * @example 2026년 9월의 기준표
 * ```ts
 * resolveRateTable(BUILT_IN_RATE_TABLES, '2026-09').effectiveFrom // '2026-07'
 * ```
 */
export function resolveRateTable(tables: readonly PayrollRateTable[], month: YearMonth): PayrollRateTable {
  let match: PayrollRateTable | undefined
  for (const table of tables) {
    if (table.effectiveFrom <= month && (match === undefined || table.effectiveFrom > match.effectiveFrom)) {
      match = table
    }
  }
  if (match === undefined) throw new RangeError(`No payroll rate table is in force in ${month}`)
  return match
}

/** 스펙으로 확인하지 못한 기준표 값의 경로 목록입니다. 예: `longTermCare.ratioOfHealthPpm` */
export function unverifiedRatePaths(table: PayrollRateTable): string[] {
  return Object.entries(table.verification)
    .filter(([, entry]) => !entry.verified)
    .map(([path]) => path)
}
