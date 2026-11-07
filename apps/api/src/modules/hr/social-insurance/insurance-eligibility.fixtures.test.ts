import { describe, expect, it } from 'vitest'
import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityFacts, Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'

/**
 * 질문 1(바꿈): 고용보험법 시행령 제3조의3에서 상호주의는 D-7·D-8·D-9만입니다. E-7은 신청해야 적용되는 임의가입이라
 * 신청 전 미적용과 신청 안내이고, D-2는 신청할 수도 없는 체류자격이라 미적용만 돌려줍니다.
 */
const notCovered = (messages: string[]) => ({
  determinations: [],
  messages,
  recommended: {
    nps: { enrolled: true },
    nhis: { enrolled: true },
    ei: { enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' },
    iais: { enrolled: true },
  },
})

const CHANGED = {
  'E-7 foreigner without agreement': notCovered(['EI_FOREIGNER_OPTIONAL']),
  'D-2 foreigner is optional': notCovered([]),
}

describeRuleFixture(
  'social-insurance-eligibility',
  (input: { facts: EligibilityFacts; current: Record<Insurance, InsuranceEnrollment>; asOf: string }) =>
    determineEligibility(input.facts, input.current, input.asOf),
  CHANGED,
)

describe('외국인 고용보험', () => {
  const foreigner = (visaCode: string): EligibilityFacts => ({
    isForeigner: true,
    isRepresentativeOrExecutive: false,
    isRepresentativeRelative: false,
    visaCode,
  })

  it('주재(D-7)는 가입을 유지하고 본국 상호주의 확인을 안내합니다', () => {
    const result = determineEligibility(foreigner('D-7'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual(['EI_FOREIGNER_RECIPROCITY_CHECK'])
    expect(result.recommended.ei).toEqual({ enrolled: true })
  })

  it('관광취업(H-1)에는 신청 가입을 안내합니다', () => {
    const result = determineEligibility(foreigner('H-1'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual(['EI_FOREIGNER_OPTIONAL'])
    expect(result.recommended.ei).toEqual({ enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' })
  })

  it('신청할 수 없는 체류자격은 안내 없이 제외합니다', () => {
    const result = determineEligibility(foreigner('D-4'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual([])
    expect(result.recommended.ei).toEqual({ enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' })
  })

  it('재외동포(F-4)는 신청 전까지 제외합니다', () => {
    const result = determineEligibility(foreigner('F-4'), DEFAULT_ENROLLMENT, '2026-06-01')
    expect(result.messages).toEqual(['EI_FOREIGNER_OPTIONAL'])
    expect(result.recommended.ei).toEqual({ enrolled: false, exclusionReason: 'EXEMPT_FOREIGNER' })
  })
})
