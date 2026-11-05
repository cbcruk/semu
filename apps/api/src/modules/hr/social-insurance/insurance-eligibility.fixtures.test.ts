import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityFacts, Insurance, InsuranceEnrollment } from './insurance-eligibility.types.ts'

describeRuleFixture(
  'social-insurance-eligibility',
  (input: { facts: EligibilityFacts; current: Record<Insurance, InsuranceEnrollment>; asOf: string }) =>
    determineEligibility(input.facts, input.current, input.asOf),
)
