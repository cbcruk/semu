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

describe('단순노무직종의 수습 감액', () => {
  const terms: WorkContractTerms = {
    contractType: 'PERMANENT',
    startDate: '2026-01-01',
    probation: { months: 3, payRatePpm: 900_000 },
  }

  it('단순노무직종은 수습 감액을 받지 않습니다', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '91001' })).toEqual([
      { field: 'probation.payRatePpm', code: 'PROBATION_REDUCTION_SIMPLE_LABOR' },
    ])
  })

  it('다른 직종이거나 직종 코드가 없으면 수습 감액을 허용합니다', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '25' })).toEqual([])
    expect(validateWorkContract(terms)).toEqual([])
  })

  it('단순노무직종도 수습 지급률 100%는 허용합니다', () => {
    expect(validateWorkContract({ ...terms, standardOccupationCode: '9', probation: { months: 3 } })).toEqual([])
  })
})
