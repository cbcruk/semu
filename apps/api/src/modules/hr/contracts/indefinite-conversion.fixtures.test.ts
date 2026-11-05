import { describe, expect, it } from 'vitest'
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

describe('term limit exemptions', () => {
  const first: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2024-01-01', endDate: '2024-12-31' }
  const latest: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2025-01-01', endDate: '2026-06-30' }

  it('exempts a chain whose latest contract has a statutory reason', () => {
    const contracts = [first, { ...latest, termLimitExemption: 'PROFESSIONAL' as const }]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: false,
      status: 'EXCEEDED',
      isExempt: true,
      exemptReason: 'PROFESSIONAL',
    })
  })

  it('prefers the age exemption', () => {
    const contracts = [first, { ...latest, termLimitExemption: 'PROFESSIONAL' as const }]
    expect(indefiniteConversion(contracts, '1960-01-01', '2026-03-01').exemptReason).toBe('AGED_55_OR_OVER')
  })

  it('ignores a reason on an earlier contract', () => {
    const contracts = [{ ...first, termLimitExemption: 'REPLACEMENT' as const }, latest]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: true,
      isExempt: false,
    })
  })
})
