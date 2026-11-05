import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { validateTaxWithholding } from './deduction-validation.ts'
import type { TaxWithholdingTerms } from './tax-withholding.types.ts'

describeRuleFixture('deduction-validation', (input: { terms: TaxWithholdingTerms }) => {
  const result = validateTaxWithholding(input.terms)
  return { firstViolation: result.violations[0]?.code ?? null, reduction: result.reduction ?? null }
})
