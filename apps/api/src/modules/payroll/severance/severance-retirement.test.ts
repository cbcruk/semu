import { describe, expect, it } from 'vitest'
import { retirementMismatchOf } from './severance-retirement.ts'

describe('retirementMismatchOf', () => {
  it('HR 퇴직일이 정산의 마지막 근무일과 같으면 어긋남이 없습니다', () => {
    expect(retirementMismatchOf('2026-10-31', { leaveDate: '2026-10-31' })).toBeNull()
  })

  it('HR에 직원이 없으면 EMPLOYEE_NOT_FOUND입니다', () => {
    expect(retirementMismatchOf('2026-10-31', undefined)).toBe('EMPLOYEE_NOT_FOUND')
  })

  it('퇴사를 취소해 퇴직일이 없으면 NOT_LEFT입니다', () => {
    expect(retirementMismatchOf('2026-10-31', { leaveDate: null })).toBe('NOT_LEFT')
  })

  it('퇴직일이 하루라도 다르면 LEAVE_DATE_CHANGED입니다', () => {
    expect(retirementMismatchOf('2026-10-31', { leaveDate: '2026-11-01' })).toBe('LEAVE_DATE_CHANGED')
    expect(retirementMismatchOf('2026-10-31', { leaveDate: '2026-10-30' })).toBe('LEAVE_DATE_CHANGED')
  })
})
