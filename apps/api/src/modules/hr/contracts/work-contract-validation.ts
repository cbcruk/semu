import type { Violation } from '../../../shared/problem/problem.types.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { addMonthsToDate } from '../shared/hr-dates.ts'
import type { WorkContractTerms } from './work-contract-validation.types.ts'

/** 수습 지급률 하한입니다(최저임금법 제5조 ②, 90%). ppm입니다. */
export const MIN_PROBATION_PAY_RATE_PPM = 900_000

/**
 * 수습 감액을 받지 않는 단순노무직종의 한국표준직업분류 대분류입니다.
 *
 * 최저임금법 제5조 ② 단서와 고용노동부고시 제2018-23호(대분류 9 단순노무 종사자)를 따릅니다.
 */
export const SIMPLE_LABOR_OCCUPATION_MAJOR_GROUP = '9'

/** 수습 지급률 기본값(100%)입니다. ppm입니다. */
export const FULL_PAY_RATE_PPM = 1_000_000

/**
 * 근로계약 조건을 검사해 위반을 모두 돌려줍니다. 빈 배열이면 통과입니다.
 *
 * - 기간제는 종료일이 필요합니다
 * - 종료일은 시작일보다 앞설 수 없습니다
 * - 수습이면 개월 수(1–12)가 필요하고, 지급률은 90–100%입니다
 * - 지급률이 100% 미만이면 1년 이상 계약이어야 합니다. 무기계약은 1년 이상으로 봅니다
 * - 지급률이 100% 미만이면 단순노무직종(한국표준직업분류 대분류 9)이 아니어야 합니다. 직종 코드가 없으면 보지 않습니다
 *
 * @example 6개월 기간제의 수습 감액
 * ```ts
 * validateWorkContract({ contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-06-30',
 *   probation: { months: 3, payRatePpm: 900_000 } })
 * // [{ field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_NOT_ALLOWED' }]
 * ```
 */
export function validateWorkContract(terms: WorkContractTerms): Violation[] {
  const violations: Violation[] = []
  if (terms.contractType === 'FIXED_TERM' && terms.endDate === undefined) {
    violations.push({ field: 'endDate', code: 'END_DATE_REQUIRED' })
  }
  if (terms.endDate !== undefined && terms.endDate < terms.startDate) {
    violations.push({ field: 'endDate', code: 'END_BEFORE_START' })
  }
  const 수습 = terms.probation
  if (수습 === undefined) return violations
  if (수습.months === undefined) {
    violations.push({ field: 'probation.months', code: 'PROBATION_MONTHS_REQUIRED' })
  } else if (!Number.isInteger(수습.months) || 수습.months < 1 || 수습.months > 12) {
    violations.push({ field: 'probation.months', code: 'PROBATION_MONTHS_OUT_OF_RANGE' })
  }
  const 수습지급률 = 수습.payRatePpm ?? FULL_PAY_RATE_PPM
  if (수습지급률 < MIN_PROBATION_PAY_RATE_PPM || 수습지급률 > FULL_PAY_RATE_PPM) {
    violations.push({ field: 'probation.payRatePpm', code: 'PROBATION_PAY_RATE_OUT_OF_RANGE' })
  } else if (
    수습지급률 < FULL_PAY_RATE_PPM &&
    terms.endDate !== undefined &&
    addMonthsToDate(terms.startDate, 12) > addDays(terms.endDate, 1)
  ) {
    violations.push({ field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_NOT_ALLOWED' })
  } else if (
    수습지급률 < FULL_PAY_RATE_PPM &&
    terms.standardOccupationCode?.startsWith(SIMPLE_LABOR_OCCUPATION_MAJOR_GROUP) === true
  ) {
    violations.push({ field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_SIMPLE_LABOR' })
  }
  return violations
}
