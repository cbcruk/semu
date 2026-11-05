import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { findBlockingDuplicate, type DuplicateCandidate } from './employee-duplicate.ts'

describeRuleFixture(
  'employee-duplicate-rrn',
  (input: { candidates: DuplicateCandidate[]; selfId?: string; isRejoin: boolean }) => ({
    blockingEmployeeId:
      findBlockingDuplicate(input.candidates, { selfId: input.selfId, isRejoin: input.isRejoin }) ?? null,
  }),
)
