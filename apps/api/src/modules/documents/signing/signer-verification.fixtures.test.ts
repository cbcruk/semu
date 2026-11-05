import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { decideVerification, identityMatches } from './signer-verification.ts'

type Identity = { name: string; birthDate?: string }
type Input =
  { check: 'attempt'; failures: number; matches: boolean } | { check: 'match'; expected: Identity; claim: Identity }

describeRuleFixture('esign-identity-verification', (input: Input) =>
  input.check === 'attempt' ? decideVerification(input) : identityMatches(input.expected, input.claim),
)
