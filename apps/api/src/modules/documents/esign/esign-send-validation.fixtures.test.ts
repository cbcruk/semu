import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { validateEsignSend } from './esign-send-validation.ts'
import type { SendCheckInput } from './esign-send-validation.types.ts'

describeRuleFixture('esign-send-validation', (input: { input: SendCheckInput }) => {
  const result = validateEsignSend(input.input)
  return {
    firstViolation: result.violations[0]?.field ?? null,
    companySealId: result.violations.length === 0 ? (result.companySealId ?? null) : null,
  }
})
