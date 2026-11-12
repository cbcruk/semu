import { describe, expect, it } from 'vitest'
import { canBeTaxFreeTarget, countDependants } from './dependant-rules.ts'

describe('비과세 보육수당 대상 자녀', () => {
  // 소득세법 제12조제3호머목2): 과세기간 개시일 현재 6세 이하("6세가 되는 날과 그 이전 기간")
  it.each([
    {
      label: '과세기간 개시일(1월 1일)에 6세가 되면 그해 내내 대상입니다',
      birthDate: '2020-01-01',
      asOf: '2026-12-31',
      target: true,
    },
    {
      label: '기준일에 만 6세여도 전년에 이미 6세가 됐으면 대상이 아닙니다',
      birthDate: '2019-12-31',
      asOf: '2026-06-01',
      target: false,
    },
    { label: '과세기간 중 6세가 되면 대상입니다', birthDate: '2020-03-01', asOf: '2026-12-31', target: true },
    { label: '과세기간 중 태어났으면 대상입니다', birthDate: '2026-03-01', asOf: '2026-06-01', target: true },
    {
      label: '기준일에 아직 태어나지 않았으면 대상이 아닙니다',
      birthDate: '2026-09-01',
      asOf: '2026-06-01',
      target: false,
    },
  ])('$label', ({ birthDate, asOf, target }) => {
    expect(canBeTaxFreeTarget({ relation: 'CHILD', birthDate }, asOf)).toBe(target)
  })

  it('법이 근로자나 배우자의 자녀만 정하므로 손자녀와 다른 관계는 대상이 아닙니다', () => {
    expect(canBeTaxFreeTarget({ relation: 'GRANDCHILD', birthDate: '2024-05-01' }, '2026-06-01')).toBe(false)
    expect(canBeTaxFreeTarget({ relation: 'SPOUSE', birthDate: '2024-05-01' }, '2026-06-01')).toBe(false)
  })
})

describe('공제대상 가족 수의 나이 기준 구분', () => {
  it('20세 이하로 공제받던 자녀가 그해 21세가 되면 세지 않습니다', () => {
    const child = {
      relation: 'CHILD',
      birthDate: '2006-03-01',
      yearEndTarget: true,
      yearEndDependantType: 'AGE_20_OR_UNDER',
    } as const
    expect(countDependants([child], '2026-12-31')).toEqual({ dependantsCount: 2, childrenAged8To20Count: 1 })
    expect(countDependants([child], '2027-01-01')).toEqual({ dependantsCount: 1, childrenAged8To20Count: 0 })
  })

  it('60세 이상 구분은 그해 60세가 되는 해부터 셉니다', () => {
    const parent = {
      relation: 'PARENT',
      birthDate: '1967-11-01',
      yearEndTarget: true,
      yearEndDependantType: 'AGE_60_OR_OVER',
    } as const
    expect(countDependants([parent], '2026-12-31').dependantsCount).toBe(1)
    expect(countDependants([parent], '2027-01-01').dependantsCount).toBe(2)
  })
})
