import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { canAddCompanySeal, notificationTargets } from './esign-settings-limits.ts'

type Recipient = { phone: string }
type Input =
  | { check: 'addSeal'; activeSealCount: number }
  | { check: 'targets'; configured: Recipient[]; representative?: Recipient }

describeRuleFixture('esign-settings-limits', (input: Input) =>
  input.check === 'addSeal'
    ? canAddCompanySeal(input.activeSealCount)
    : (notificationTargets(input.configured, input.representative) ?? 'RECIPIENT_LIMIT_EXCEEDED'),
)
