import { describe, expect, it } from 'vitest'
import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityFacts, Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'

/**
 * 질문 1(바꿈): 고용보험법 시행령 제3조의3에서 E-7은 신청해야 적용되는 임의가입이고, 상호주의는 D-7·D-8·D-9만입니다.
 */
const CHANGED = {
  'E-7 foreigner without agreement': {
    determinations: [],
    messages: ['EI_FOREIGNER_OPTIONAL'],
    recommended: {
      nps: { enrolled: true },
      nhis: { enrolled: true },
      ei: { enrolled: true },
      iais: { enrolled: true },
    },
  },
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

  it('treats an overseas Korean as optional', () => {
    expect(determineEligibility(foreigner('F-4'), DEFAULT_ENROLLMENT, '2026-06-01').messages).toEqual([
      'EI_FOREIGNER_OPTIONAL',
    ])
  })
})
