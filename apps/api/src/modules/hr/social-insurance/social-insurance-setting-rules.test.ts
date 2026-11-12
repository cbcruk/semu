import { describe, expect, it } from 'vitest'
import { eligibilityMismatches, enrollmentViolations } from './social-insurance-setting-rules.ts'

const allEnrolled = {
  nps: { enrolled: true },
  nhis: { enrolled: true },
  ei: { enrolled: true },
  iais: { enrolled: true },
} as const

describe('4대보험 가입 설정 규칙', () => {
  it('가입하지 않는 보험은 제외 사유가 있어야 하고 가입하는 보험은 제외 사유가 없어야 합니다', () => {
    expect(
      enrollmentViolations({
        ...allEnrolled,
        nps: { enrolled: false },
        ei: { enrolled: true, exclusionReason: 'OTHER' },
      }),
    ).toEqual([
      { field: 'nps.exclusionReason', code: 'REQUIRED' },
      { field: 'ei.exclusionReason', code: 'NOT_APPLICABLE' },
    ])
    expect(enrollmentViolations(allEnrolled)).toEqual([])
  })

  it('가입 여부가 판정과 다른 보험만 찾고 제외 사유 차이는 보지 않습니다', () => {
    expect(
      eligibilityMismatches(
        { ...allEnrolled, nps: { enrolled: false, exclusionReason: 'OTHER' } },
        { ...allEnrolled, ei: { enrolled: false, exclusionReason: 'SHORT_PART_TIME' } },
      ),
    ).toEqual(['nps', 'ei'])
    expect(
      eligibilityMismatches(
        { ...allEnrolled, nps: { enrolled: false, exclusionReason: 'OTHER' } },
        { ...allEnrolled, nps: { enrolled: false, exclusionReason: 'AGE_60_OR_OVER' } },
      ),
    ).toEqual([])
  })
})
