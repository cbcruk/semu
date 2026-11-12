import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'

/** 보험 순서입니다. 국민연금·건강보험·고용보험·산재보험입니다. */
export const INSURANCES: ReadonlyArray<Insurance> = ['nps', 'nhis', 'ei', 'iais']

/**
 * 저장할 가입 설정을 봅니다. 가입하지 않는 보험은 제외 사유가 있어야 하고(`REQUIRED`), 가입하는 보험은 제외 사유가
 * 없어야 합니다(`NOT_APPLICABLE`). 상실·취득 신고에 사유 코드가 들어가기 때문입니다.
 */
export function enrollmentViolations(enrollments: Readonly<Record<Insurance, InsuranceEnrollment>>): Violation[] {
  const violations: Violation[] = []
  for (const insurance of INSURANCES) {
    const { enrolled, exclusionReason } = enrollments[insurance]
    if (!enrolled && exclusionReason === undefined) {
      violations.push({ field: `${insurance}.exclusionReason`, code: 'REQUIRED' })
    }
    if (enrolled && exclusionReason !== undefined) {
      violations.push({ field: `${insurance}.exclusionReason`, code: 'NOT_APPLICABLE' })
    }
  }
  return violations
}

/**
 * 저장한 가입 여부가 판정과 다른 보험입니다. 사용자는 판정과 다르게 저장할 수 있고, 다른 보험은 경고로만 보여 줍니다.
 * 제외 사유가 달라도 가입 여부가 같으면 다르다고 보지 않습니다.
 */
export function eligibilityMismatches(
  stored: Readonly<Record<Insurance, InsuranceEnrollment>>,
  recommended: Readonly<Record<Insurance, InsuranceEnrollment>>,
): Insurance[] {
  return INSURANCES.filter((insurance) => stored[insurance].enrolled !== recommended[insurance].enrolled)
}
