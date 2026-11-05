import { describe, expect, it } from 'vitest'
import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { nhisDeferredMonths, summarizeLeaves, validateLeave } from './leave-rules.ts'
import type { ExistingLeave, LeaveContext, LeaveTerms } from './leave-rules.types.ts'

type Input =
  | { check: 'validate'; terms: LeaveTerms; context: LeaveContext }
  | { check: 'summarize'; leaves: ExistingLeave[]; asOf: string }

/**
 * 질문 3(바꿈): 유예되는 달이 있으면 받습니다(국민건강보험법 시행규칙 제50조 ④). 3월 1일 시작이면 3월이 유예됩니다.
 */
const CHANGED = {
  'nhis deferral on a short leave': {
    firstViolation: null,
    expectedReturnDate: '2026-03-31',
    includeInServiceYears: false,
  },
}

describeRuleFixture(
  'leave-validation',
  (input: Input) => {
    if (input.check === 'summarize') return summarizeLeaves(input.leaves, input.asOf)
    const result = validateLeave(input.terms, input.context)
    const firstViolation =
      result.violations[0]?.code ?? (result.overlappingLeaveId === undefined ? null : 'LEAVE_OVERLAP')
    return { firstViolation, ...(firstViolation === null ? result.normalized : {}) }
  },
  CHANGED,
)

describe('nhisDeferredMonths', () => {
  it.each([
    ['2026-03-01', '2026-03-30', { first: '2026-03', last: '2026-03' }],
    ['2026-03-01', '2026-03-31', { first: '2026-03', last: '2026-03' }],
    ['2026-01-20', '2026-02-05', { first: '2026-02', last: '2026-02' }],
    ['2026-01-15', '2026-04-14', { first: '2026-02', last: '2026-04' }],
    ['2026-03-15', '2026-03-31', undefined],
    ['2026-03-02', '2026-03-20', undefined],
  ])('%s to %s', (start, end, expected) => {
    expect(nhisDeferredMonths(start, end)).toEqual(expected)
  })
})
