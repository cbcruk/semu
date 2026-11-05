import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { summarizeLeaves, validateLeave } from './leave-rules.ts'
import type { ExistingLeave, LeaveContext, LeaveTerms } from './leave-rules.types.ts'

type Input =
  | { check: 'validate'; terms: LeaveTerms; context: LeaveContext }
  | { check: 'summarize'; leaves: ExistingLeave[]; asOf: string }

describeRuleFixture('leave-validation', (input: Input) => {
  if (input.check === 'summarize') return summarizeLeaves(input.leaves, input.asOf)
  const result = validateLeave(input.terms, input.context)
  const firstViolation =
    result.violations[0]?.code ?? (result.overlappingLeaveId === undefined ? null : 'LEAVE_OVERLAP')
  return { firstViolation, ...(firstViolation === null ? result.normalized : {}) }
})
