import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  decideInsuranceFilingProcess,
  withdrawnEmployeeFilings,
  withdrawnFilings,
} from './insurance-filing.aggregate.ts'
import type { InsuranceFiling, InsuranceFilingStatus } from './insurance-filing.types.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const OTHER_EMPLOYEE = 'emp_01JBQ000000000000000000002' as Id<'employee'>
const AT = '2026-11-14T01:00:00.000Z'

function filing(
  n: number,
  status: InsuranceFilingStatus,
  overrides: { kind?: 'LEAVE' | 'RETURN'; sourceId?: string; employeeId?: Id<'employee'> } = {},
): InsuranceFiling {
  const kind = overrides.kind ?? 'RETURN'
  return {
    id: `isf_01JBQ00000000000000000000${n}` as Id<'insuranceFiling'>,
    companyId: COMPANY,
    employeeId: overrides.employeeId ?? EMPLOYEE,
    kind,
    source: { type: 'LEAVE', id: overrides.sourceId ?? 'lev_1' },
    payload:
      kind === 'RETURN'
        ? { leaveStartDate: '2026-03-02', returnDate: '2026-05-15' }
        : { startDate: '2026-03-02', endDate: '2026-05-31', npsPaymentException: false, nhisNoticeDeferral: false },
    status,
    requestedAt: '2026-05-01T00:00:00.000Z',
  } as InsuranceFiling
}

describe('4대보험 신고 처리 판정', () => {
  it('실패한 신고를 완료하면 사유를 지우고, 닫힌 신고는 지금 상태와 함께 거부합니다', () => {
    const failed = { ...filing(1, 'FAILED'), resultMessage: '주민번호 불일치' }
    const done = decideInsuranceFilingProcess(failed, { type: 'COMPLETE' }, AT)
    if (Result.isFailure(done)) throw done.failure
    expect(done.success.filing).toMatchObject({ status: 'DONE', processedAt: AT })
    expect(done.success.filing).not.toHaveProperty('resultMessage')

    const again = decideInsuranceFilingProcess(done.success.filing, { type: 'FAIL', message: '반려' }, AT)
    expect(Result.isFailure(again) && again.failure).toMatchObject({
      _tag: 'InsuranceFilingTransitionInvalid',
      currentStatus: 'DONE',
    })
  })
})

describe('열린 신고 거두기', () => {
  it('원인과 종류가 같은 열린 신고만 거둡니다', () => {
    const all = [
      filing(1, 'PENDING'),
      filing(2, 'FAILED'),
      filing(3, 'DONE'),
      filing(4, 'PENDING', { kind: 'LEAVE' }),
      filing(5, 'PENDING', { sourceId: 'lev_2' }),
    ]
    const withdrawn = withdrawnFilings(all, { type: 'LEAVE', id: 'lev_1' }, 'RETURN', AT)
    expect(withdrawn.map((one) => [one.id.slice(-1), one.status, one.processedAt])).toEqual([
      ['1', 'WITHDRAWN', AT],
      ['2', 'WITHDRAWN', AT],
    ])
  })

  it('직원을 지우면 그 직원의 열린 신고를 종류와 관계없이 거둡니다', () => {
    const all = [
      filing(1, 'PENDING'),
      filing(2, 'PENDING', { kind: 'LEAVE' }),
      filing(3, 'DONE'),
      filing(4, 'PENDING', { employeeId: OTHER_EMPLOYEE }),
    ]
    expect(withdrawnEmployeeFilings(all, EMPLOYEE, AT).map((one) => one.id.slice(-1))).toEqual(['1', '2'])
  })
})
