import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { indefiniteConversion } from './indefinite-conversion.ts'
import type { ContractPeriod } from './work-contract-period.types.ts'

describeRuleFixture(
  'indefinite-conversion-alert',
  (input: { contracts: ContractPeriod[]; birthDate?: string; asOf: string }) => {
    const result = indefiniteConversion(input.contracts, input.birthDate, input.asOf)
    return {
      isTarget: result.isTarget,
      status: result.status,
      isExempt: result.isExempt,
      conversionDate: result.conversionDate ?? null,
    }
  },
)
