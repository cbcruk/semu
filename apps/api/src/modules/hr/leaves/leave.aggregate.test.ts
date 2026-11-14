import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decideLeaveCreation, decideLeaveRemoval, decideLeaveReturn, type LeaveFacts } from './leave.aggregate.ts'
import type { LeaveRecord } from './leave.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const LEAVE = 'lev_01JBQ000000000000000000001' as Id<'leave'>
const WAGE: LeaveFacts = { employee: { joinDate: '2024-03-01', kind: 'WAGE' }, otherLeaves: [] }

function create(
  facts: LeaveFacts = WAGE,
  terms = { reason: 'ILLNESS' as const, startDate: '2026-03-02', endDate: '2026-05-31' },
) {
  return decideLeaveCreation({ id: LEAVE, companyId: COMPANY, employeeId: EMPLOYEE, terms }, facts)
}

function created(facts: LeaveFacts = WAGE): LeaveRecord {
  const result = create(facts)
  if (Result.isFailure(result)) throw result.failure
  return result.success.leave
}

describe('휴직 등록 판정', () => {
  it('복직 예정일을 채우고 근로소득자면 휴직 신고를 엽니다', () => {
    const result = create()
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.leave).toMatchObject({
      expectedReturnDate: '2026-06-01',
      npsPaymentException: false,
      version: 1,
    })
    expect(result.success.filings).toEqual([
      {
        action: 'OPEN',
        kind: 'LEAVE',
        payload: {
          startDate: '2026-03-02',
          endDate: '2026-05-31',
          npsPaymentException: false,
          nhisNoticeDeferral: false,
        },
      },
    ])
  })

  it('근로소득자가 아니면 신고를 열지 않습니다', () => {
    const result = create({ ...WAGE, employee: { joinDate: '2024-03-01', kind: 'BUSINESS' } })
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.filings).toEqual([])
  })

  it('입사일 전이면 LeaveInvalid, 다른 휴직과 겹치면 LeaveOverlap입니다', () => {
    const early = create(WAGE, { reason: 'ILLNESS', startDate: '2024-02-01', endDate: '2024-03-31' })
    const overlap = create({
      ...WAGE,
      otherLeaves: [{ ...created(), id: 'lev_01JBQ000000000000000000002' as Id<'leave'> }],
    })
    expect(Result.isFailure(early) && early.failure._tag).toBe('LeaveInvalid')
    expect(Result.isFailure(overlap) && overlap.failure).toMatchObject({
      _tag: 'LeaveOverlap',
      overlappingLeaveId: 'lev_01JBQ000000000000000000002',
    })
  })
})

describe('복직 판정', () => {
  it('복직일을 남기고 버전을 올리며, 이전 복직 신고를 거두고 새로 엽니다', () => {
    const result = decideLeaveReturn(created(), '2026-05-15', WAGE)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.leave).toMatchObject({ actualReturnDate: '2026-05-15', version: 2 })
    expect(result.success.filings).toEqual([
      { action: 'WITHDRAW', kind: 'RETURN' },
      { action: 'OPEN', kind: 'RETURN', payload: { leaveStartDate: '2026-03-02', returnDate: '2026-05-15' } },
    ])
  })

  it('휴직 기간 밖의 복직일은 거부합니다', () => {
    const result = decideLeaveReturn(created(), '2026-08-01', WAGE)
    expect(Result.isFailure(result) && result.failure._tag).toBe('LeaveInvalid')
  })
})

describe('휴직 삭제 판정', () => {
  it('휴직 신고와 복직 신고를 함께 거둡니다', () => {
    expect(decideLeaveRemoval().filings).toEqual([
      { action: 'WITHDRAW', kind: 'LEAVE' },
      { action: 'WITHDRAW', kind: 'RETURN' },
    ])
  })
})
