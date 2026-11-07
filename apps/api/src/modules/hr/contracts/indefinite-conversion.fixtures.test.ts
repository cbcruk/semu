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

describe('사용기간 제한 예외', () => {
  const first: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2024-01-01', endDate: '2024-12-31' }
  const latest: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2025-01-01', endDate: '2026-06-30' }

  it('가장 늦은 계약에 법정 예외 사유가 있으면 사슬 전체가 예외입니다', () => {
    const contracts = [first, { ...latest, termLimitExemption: 'PROFESSIONAL' as const }]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: false,
      status: 'EXCEEDED',
      isExempt: true,
      exemptReason: 'PROFESSIONAL',
    })
  })

  it('만 55세 예외가 다른 예외 사유보다 먼저입니다', () => {
    const contracts = [first, { ...latest, termLimitExemption: 'PROFESSIONAL' as const }]
    expect(indefiniteConversion(contracts, '1960-01-01', '2026-03-01').exemptReason).toBe('AGED_55_OR_OVER')
  })

  it('예외 계약 전에 일반 계약이 이미 전환일에 닿았으면 전환을 유지합니다', () => {
    const contracts: ContractPeriod[] = [
      { contractType: 'FIXED_TERM', startDate: '2023-01-01', endDate: '2023-12-31' },
      { contractType: 'FIXED_TERM', startDate: '2024-01-01', endDate: '2025-06-30' },
      { contractType: 'FIXED_TERM', startDate: '2025-07-01', endDate: '2026-06-30', termLimitExemption: 'REPLACEMENT' },
    ]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: true,
      status: 'EXCEEDED',
      isExempt: false,
      conversionDate: '2025-01-01',
    })
  })

  it('예외 계약 뒤의 일반 계약이 전환일을 넘기면 전환합니다', () => {
    const contracts: ContractPeriod[] = [
      { contractType: 'FIXED_TERM', startDate: '2023-01-01', endDate: '2024-06-30' },
      { contractType: 'FIXED_TERM', startDate: '2024-07-01', endDate: '2025-06-30', termLimitExemption: 'REPLACEMENT' },
      { contractType: 'FIXED_TERM', startDate: '2025-07-01', endDate: '2026-06-30' },
    ]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: true,
      isExempt: false,
    })
  })

  it('전환일을 넘긴 계약이 예외 계약뿐이면 예외로 남습니다', () => {
    const contracts: ContractPeriod[] = [
      { contractType: 'FIXED_TERM', startDate: '2023-01-01', endDate: '2024-06-30' },
      { contractType: 'FIXED_TERM', startDate: '2024-07-01', endDate: '2026-06-30', termLimitExemption: 'REPLACEMENT' },
    ]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: false,
      isExempt: true,
      exemptReason: 'REPLACEMENT',
    })
  })

  it('앞선 계약의 예외 사유는 보지 않습니다', () => {
    const contracts = [{ ...first, termLimitExemption: 'REPLACEMENT' as const }, latest]
    expect(indefiniteConversion(contracts, '1990-01-01', '2026-03-01')).toMatchObject({
      isTarget: true,
      isExempt: false,
    })
  })
})
