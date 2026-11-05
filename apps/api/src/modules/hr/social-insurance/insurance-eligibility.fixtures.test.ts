import { describe, expect, it } from 'vitest'
import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityFacts, Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'

/**
 * 질문 1(바꿈): 고용보험법 시행령 제3조의3에서 상호주의는 D-7·D-8·D-9만입니다. E-7 같은 취업 체류자격은 신청해야
 * 적용되는 임의가입이고, D-2처럼 목록에 없는 체류자격은 적용하지 않으므로 둘 다 신청 전 기본값은 미적용입니다.
 */
const NOT_COVERED = {
  determinations: [],
  messages: ['EI_FOREIGNER_OPTIONAL'],
  recommended: {
    nps: { enrolled: true },
    nhis: { enrolled: true },
    ei: { enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' },
    iais: { enrolled: true },
  },
}

const CHANGED = {
  'E-7 foreigner without agreement': NOT_COVERED,
  'D-2 foreigner is optional': NOT_COVERED,
}

describeRuleFixture(
  'social-insurance-eligibility',
  (input: { facts: EligibilityFacts; current: Record<Insurance, InsuranceEnrollment>; asOf: string }) =>
    determineEligibility(input.facts, input.current, input.asOf),
  CHANGED,
)

describe('foreigner employment insurance', () => {
  const foreigner = (visaCode: string): EligibilityFacts => ({
    isForeigner: true,
    isRepresentativeOrExecutive: false,
    isRepresentativeRelative: false,
    visaCode,
  })

  it('keeps an intra-company transferee enrolled and asks to check reciprocity', () => {
    const result = determineEligibility(foreigner('D-7'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual(['EI_FOREIGNER_RECIPROCITY_CHECK'])
    expect(result.recommended.ei).toEqual({ enrolled: true })
  })

  it('leaves an overseas Korean out until they apply', () => {
    const result = determineEligibility(foreigner('F-4'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual(['EI_FOREIGNER_OPTIONAL'])
    expect(result.recommended.ei).toEqual({ enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' })
  })
})
