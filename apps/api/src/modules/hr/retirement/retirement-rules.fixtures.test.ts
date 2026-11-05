import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { checkResignation } from './retirement-rules.ts'
import type { Resignation, RetirementPlan } from './retirement.types.ts'

describeRuleFixture(
  'retirement-validation',
  (input: { resignation: Resignation; context: { joinDate?: string; plan?: RetirementPlan } }) => ({
    rejection: checkResignation(input.resignation, input.context) ?? null,
  }),
)
