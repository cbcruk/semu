import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { validateWorkContract } from './work-contract-validation.ts'
import type { WorkContractTerms } from './work-contract-validation.types.ts'

/** 결정 1(바꿈): 종료일 다음날까지가 1년이면 1년 계약으로 봅니다. */
const CHANGED = {
  'reduced probation pay on a one-year contract ending 12-31': { firstViolation: null },
}

describeRuleFixture(
  'work-contract-validation',
  (input: { terms: WorkContractTerms }) => ({ firstViolation: validateWorkContract(input.terms)[0]?.code ?? null }),
  CHANGED,
)
