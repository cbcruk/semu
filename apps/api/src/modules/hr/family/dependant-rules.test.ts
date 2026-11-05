import { describe, expect, it } from 'vitest'
import { canBeTaxFreeTarget } from './dependant-rules.ts'

describe('canBeTaxFreeTarget', () => {
  // 소득세법 제12조제3호머목2): 과세기간 개시일 현재 6세 이하("6세가 되는 날과 그 이전 기간")
  it.each([
    {
      label: 'turned 6 on Jan 1 of the tax year: target all year',
      birthDate: '2020-01-01',
      asOf: '2026-12-31',
      target: true,
    },
    {
      label: 'past 6 on Jan 1 though aged 6 on the date: not a target',
      birthDate: '2019-12-31',
      asOf: '2026-06-01',
      target: false,
    },
    { label: 'turns 6 during the tax year: target', birthDate: '2020-03-01', asOf: '2026-12-31', target: true },
    { label: 'born during the tax year: target', birthDate: '2026-03-01', asOf: '2026-06-01', target: true },
    { label: 'not yet born on the date: not a target', birthDate: '2026-09-01', asOf: '2026-06-01', target: false },
  ])('$label', ({ birthDate, asOf, target }) => {
    expect(canBeTaxFreeTarget({ relation: 'CHILD', birthDate }, asOf)).toBe(target)
  })

  it('accepts grandchildren and rejects other relations', () => {
    expect(canBeTaxFreeTarget({ relation: 'GRANDCHILD', birthDate: '2024-05-01' }, '2026-06-01')).toBe(true)
    expect(canBeTaxFreeTarget({ relation: 'SPOUSE', birthDate: '2024-05-01' }, '2026-06-01')).toBe(false)
  })
})
