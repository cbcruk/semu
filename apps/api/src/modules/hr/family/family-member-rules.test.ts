import { describe, expect, it } from 'vitest'
import { dependantChange, validateFamilyMember, type FamilyMemberTerms } from './family-member-rules.ts'

const spouse: FamilyMemberTerms = {
  relation: 'SPOUSE',
  birthDate: '1990-01-01',
  taxFreeTarget: false,
  yearEndTarget: true,
  yearEndDependantType: 'SPOUSE',
  healthInsuranceDependant: false,
}

describe('가족 입력 검사', () => {
  it('맞는 입력은 위반이 없고 주민번호의 하이픈을 뺍니다', () => {
    expect(validateFamilyMember({ ...spouse, registrationNumber: '900101-2234567' }, '2026-06-01')).toEqual({
      violations: [],
      registrationNumber: '9001012234567',
    })
  })

  it('6세 이하 자녀가 아니면 비과세 대상이 될 수 없습니다', () => {
    const result = validateFamilyMember({ ...spouse, taxFreeTarget: true }, '2026-06-01')
    expect(result.violations).toEqual([{ field: 'taxFreeTarget', code: 'NOT_ELIGIBLE' }])
    const child = {
      ...spouse,
      relation: 'CHILD',
      birthDate: '2021-03-01',
      yearEndDependantType: 'AGE_20_OR_UNDER',
    } as const
    expect(validateFamilyMember({ ...child, taxFreeTarget: true }, '2026-06-01').violations).toEqual([])
  })

  it('연말정산 대상 여부와 공제 구분이 맞아야 합니다', () => {
    expect(validateFamilyMember({ ...spouse, yearEndDependantType: 'NOT_ELIGIBLE' }, '2026-06-01').violations).toEqual([
      { field: 'yearEndDependantType', code: 'REQUIRED' },
    ])
    expect(validateFamilyMember({ ...spouse, yearEndTarget: false }, '2026-06-01').violations).toEqual([
      { field: 'yearEndDependantType', code: 'NOT_APPLICABLE' },
    ])
  })

  it('공제 구분이 관계와 연 나이에 맞아야 합니다', () => {
    const child = { ...spouse, relation: 'CHILD', yearEndDependantType: 'AGE_20_OR_UNDER' } as const
    // 소득세법 제50조③: 과세기간 중 20세 이하인 날이 있으면 대상이라 연도 − 출생 연도로 봅니다.
    expect(validateFamilyMember({ ...child, birthDate: '2006-12-31' }, '2026-06-01').violations).toEqual([])
    expect(validateFamilyMember({ ...child, birthDate: '2005-12-31' }, '2026-06-01').violations).toEqual([
      { field: 'yearEndDependantType', code: 'INCONSISTENT' },
    ])
    expect(validateFamilyMember({ ...child, yearEndDependantType: 'SPOUSE' }, '2026-06-01').violations).toEqual([
      { field: 'yearEndDependantType', code: 'INCONSISTENT' },
    ])
    const parent = { ...spouse, relation: 'PARENT', yearEndDependantType: 'AGE_60_OR_OVER' } as const
    expect(validateFamilyMember({ ...parent, birthDate: '1966-12-31' }, '2026-06-01').violations).toEqual([])
    expect(validateFamilyMember({ ...parent, birthDate: '1967-01-01' }, '2026-06-01').violations).toEqual([
      { field: 'yearEndDependantType', code: 'INCONSISTENT' },
    ])
  })

  it('피부양자는 국민건강보험법의 관계여야 하고 주민번호가 있어야 합니다', () => {
    expect(validateFamilyMember({ ...spouse, healthInsuranceDependant: true }, '2026-06-01').violations).toEqual([
      { field: 'registrationNumber', code: 'REQUIRED' },
    ])
    const other = {
      ...spouse,
      relation: 'OTHER',
      yearEndTarget: false,
      yearEndDependantType: 'NOT_ELIGIBLE',
      healthInsuranceDependant: true,
      registrationNumber: '9001012234567',
    } as const
    expect(validateFamilyMember(other, '2026-06-01').violations).toEqual([
      { field: 'healthInsuranceDependant', code: 'NOT_ELIGIBLE' },
    ])
  })

  it('주민번호 형식과 생년월일을 확인합니다', () => {
    expect(validateFamilyMember({ ...spouse, registrationNumber: '12345' }, '2026-06-01').violations).toEqual([
      { field: 'registrationNumber', code: 'INVALID_FORMAT' },
    ])
    expect(validateFamilyMember({ ...spouse, registrationNumber: '9102012234567' }, '2026-06-01').violations).toEqual([
      { field: 'registrationNumber', code: 'BIRTH_DATE_MISMATCH' },
    ])
  })
})

describe('피부양자 신고 구분', () => {
  const done = (change: 'ADD' | 'REMOVE', processedAt: string) => ({
    status: 'DONE' as const,
    processedAt,
    payload: { change },
  })

  it('등록되지 않은 가족을 피부양자로 두면 취득 신고입니다', () => {
    expect(dependantChange(true, [])).toBe('ADD')
    expect(dependantChange(false, [])).toBeUndefined()
  })

  it('공단 상태는 가장 나중에 완료한 신고로 봅니다', () => {
    const filings = [done('REMOVE', '2026-05-01T00:00:00.000Z'), done('ADD', '2026-03-01T00:00:00.000Z')]
    expect(dependantChange(true, filings)).toBe('ADD')
    expect(dependantChange(false, filings)).toBeUndefined()
    expect(dependantChange(false, [done('ADD', '2026-03-01T00:00:00.000Z')])).toBe('REMOVE')
  })

  it('열린 신고는 아직 공단에 반영되지 않아 상태에 넣지 않습니다', () => {
    const pending = { status: 'PENDING' as const, payload: { change: 'ADD' as const } }
    expect(dependantChange(true, [pending])).toBe('ADD')
    expect(dependantChange(false, [pending])).toBeUndefined()
    const failed = {
      status: 'FAILED' as const,
      processedAt: '2026-05-01T00:00:00.000Z',
      payload: { change: 'ADD' as const },
    }
    expect(dependantChange(true, [failed])).toBe('ADD')
    expect(dependantChange(false, [failed])).toBeUndefined()
  })
})
