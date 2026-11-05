import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { canBeTaxFreeTarget, countDependants } from './dependant-rules.ts'
import type { FamilyRelation } from './family-member.types.ts'

type Input =
  | { check: 'count'; members: { relation: FamilyRelation; birthDate: string; yearEndTarget: boolean }[]; asOf: string }
  | { check: 'taxFree'; member: { relation: FamilyRelation; birthDate: string }; asOf: string }

describeRuleFixture('dependant-count', (input: Input) =>
  input.check === 'count' ? countDependants(input.members, input.asOf) : canBeTaxFreeTarget(input.member, input.asOf),
)
