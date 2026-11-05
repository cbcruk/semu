import { describe, expect, it } from 'vitest'
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

describe('simple labor probation', () => {
  const terms: WorkContractTerms = {
    contractType: 'PERMANENT',
    startDate: '2026-01-01',
    probation: { months: 3, payRatePpm: 900_000 },
  }

  it('rejects reduced pay for an elementary occupation', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '91001' })).toEqual([
      { field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_SIMPLE_LABOR' },
    ])
  })

  it('allows reduced pay for other occupations and when the code is missing', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '25' })).toEqual([])
    expect(validateWorkContract(terms)).toEqual([])
  })

  it('allows full pay for an elementary occupation', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '9', probation: { months: 3 } })).toEqual([])
  })
})
