import { describe, expect, it } from 'vitest'
import { signedTermsOf } from './signed-terms.ts'

describe('서명 완료 문서의 계약 조건(signedTermsOf)', () => {
  it('근로계약서는 근로개시일만 뽑습니다', () => {
    expect(signedTermsOf('EMPLOYMENT_CONTRACT', { startDate: '2026-03-01', workPlace: '본사' })).toEqual({
      startDate: '2026-03-01',
    })
  })

  it('연봉계약서는 적용 시작일과 연봉을 뽑습니다', () => {
    expect(signedTermsOf('SALARY_CONTRACT', { effectiveDate: '2026-04-01', annualSalary: 42_000_000 })).toEqual({
      effectiveDate: '2026-04-01',
      annualSalary: 42_000_000,
    })
  })

  it('형식이 틀린 값은 버립니다', () => {
    expect(signedTermsOf('EMPLOYMENT_CONTRACT', { startDate: '2026-02-30' })).toEqual({})
    expect(signedTermsOf('SALARY_CONTRACT', { effectiveDate: 20260401, annualSalary: '42000000' })).toEqual({})
    expect(signedTermsOf('SALARY_CONTRACT', { annualSalary: -1 })).toEqual({})
    expect(signedTermsOf('SALARY_CONTRACT', { annualSalary: 1.5 })).toEqual({})
  })

  it('비워 둔 필드는 없습니다', () => {
    expect(signedTermsOf('EMPLOYMENT_CONTRACT', {})).toEqual({})
  })

  it('증명서는 뽑을 조건이 없습니다', () => {
    expect(signedTermsOf('EMPLOYMENT_CERTIFICATE', { purpose: '은행 제출' })).toEqual({})
  })
})
