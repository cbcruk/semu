import type { Violation } from '../../../shared/problem/problem.types.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { addMonthsToDate } from '../shared/hr-dates.ts'
import { INCOME_TAX_REDUCTION_REASONS } from './income-tax-reduction-reasons.ts'
import type { ResolvedReduction, TaxWithholdingTerms } from './tax-withholding.types.ts'

/** 소득세액 조정비율로 고를 수 있는 값입니다(소득세법 시행령 제194조 ②). */
export const ADJUSTMENT_RATES_PPM: ReadonlyArray<number> = [800_000, 1_000_000, 1_200_000]

/**
 * 소득세 공제 설정을 검사합니다(현행 R19·R20).
 *
 * - 직접입력이면 세액 필수, 조정비율은 80/100/120%
 * - 감면이면 그 유형의 사유(유형에 사유가 하나뿐이면 자동 선택), 적용 방식, 기간이 필요하고,
 *   종료일은 시작일 이후이며 사유의 법정 기간(시작일 + N년 − 1일)을 넘을 수 없음
 * - 감면율은 그 유형 사유들의 감면율 중 하나. 비우면 사유의 감면율
 * - 학자금 상환이면 월 공제액과 시작일 필수
 */
export function validateTaxWithholding(terms: TaxWithholdingTerms): {
  violations: Violation[]
  reduction?: ResolvedReduction
} {
  const violations: Violation[] = []
  if (terms.calcMethod === 'MANUAL' && terms.manualIncomeTax === undefined) {
    violations.push({ field: 'manualIncomeTax', code: 'REQUIRED' })
  }
  if (!ADJUSTMENT_RATES_PPM.includes(terms.adjustmentRatePpm)) {
    violations.push({ field: 'adjustmentRatePpm', code: 'ADJUSTMENT_RATE_NOT_ALLOWED' })
  }
  let reduction: ResolvedReduction | undefined
  const input = terms.reduction
  if (input !== undefined) {
    const candidates = INCOME_TAX_REDUCTION_REASONS.filter((reason) => reason.type === input.type)
    const reason =
      candidates.find((candidate) => candidate.code === input.reasonCode) ??
      (candidates.length === 1 ? candidates[0] : undefined)
    if (reason === undefined) violations.push({ field: 'reduction.reasonCode', code: 'REDUCTION_REASON_REQUIRED' })
    if (input.application === undefined) violations.push({ field: 'reduction.application', code: 'REQUIRED' })
    if (input.startDate === undefined || input.endDate === undefined) {
      violations.push({ field: 'reduction.startDate', code: 'REDUCTION_PERIOD_REQUIRED' })
    } else if (input.endDate < input.startDate) {
      violations.push({ field: 'reduction.endDate', code: 'END_BEFORE_START' })
    } else if (
      reason !== undefined &&
      input.endDate > addDays(addMonthsToDate(input.startDate, reason.periodYears * 12), -1)
    ) {
      violations.push({ field: 'reduction.endDate', code: 'REDUCTION_PERIOD_TOO_LONG' })
    }
    const allowed = candidates.map((candidate) => candidate.ratePpm)
    if (input.ratePpm !== undefined && !allowed.includes(input.ratePpm)) {
      violations.push({ field: 'reduction.ratePpm', code: 'REDUCTION_RATE_NOT_ALLOWED' })
    }
    if (reason !== undefined) reduction = { reasonCode: reason.code, ratePpm: input.ratePpm ?? reason.ratePpm }
  }
  const loan = terms.studentLoan
  if (loan !== undefined && (loan.monthlyAmount === undefined || loan.startDate === undefined)) {
    violations.push({ field: 'studentLoan.monthlyAmount', code: 'STUDENT_LOAN_INCOMPLETE' })
  }
  return violations.length === 0 && reduction !== undefined ? { violations, reduction } : { violations }
}
