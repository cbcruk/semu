import { describe, expect, it } from 'vitest'
import { checkResignation, isSeveranceSettled, latestCompletedInterimDate } from './retirement-rules.ts'
import type { SeveranceSettlementSummary } from './retirement.types.ts'

const retirement = (status: SeveranceSettlementSummary['status']): SeveranceSettlementSummary => ({
  kind: 'RETIREMENT',
  status,
  lastWorkDate: '2026-10-31',
})
const interim = (
  status: SeveranceSettlementSummary['status'],
  lastWorkDate = '2026-03-31',
): SeveranceSettlementSummary => ({
  kind: 'INTERIM',
  status,
  lastWorkDate,
})

describe('isSeveranceSettled', () => {
  it('정산이 없으면 막지 않습니다', () => {
    expect(isSeveranceSettled([], 'DELETE')).toBe(false)
  })

  it('계산됨·제외만 있으면 막지 않습니다', () => {
    expect(isSeveranceSettled([retirement('CALCULATED'), retirement('EXCLUDED')], 'RESIGNATION')).toBe(false)
  })

  it('퇴직 정산 중 하나라도 지급 완료면 삭제도 퇴사 변경도 막습니다', () => {
    const settlements = [retirement('EXCLUDED'), retirement('COMPLETED')]
    expect(isSeveranceSettled(settlements, 'DELETE')).toBe(true)
    expect(isSeveranceSettled(settlements, 'RESIGNATION')).toBe(true)
  })

  it('완료한 중간정산은 삭제만 막고 퇴사·퇴사 취소는 막지 않습니다', () => {
    expect(isSeveranceSettled([interim('COMPLETED')], 'DELETE')).toBe(true)
    expect(isSeveranceSettled([interim('COMPLETED')], 'RESIGNATION')).toBe(false)
  })
})

describe('latestCompletedInterimDate', () => {
  it('완료한 중간정산 중 가장 늦은 기준일입니다', () => {
    expect(
      latestCompletedInterimDate([
        interim('COMPLETED', '2025-03-31'),
        interim('COMPLETED', '2026-03-31'),
        interim('CALCULATED', '2026-09-30'),
        retirement('COMPLETED'),
      ]),
    ).toBe('2026-03-31')
    expect(latestCompletedInterimDate([interim('EXCLUDED')])).toBeUndefined()
  })

  it('퇴직일이 완료 중간정산 기준일보다 앞서면 LEAVE_DATE_BEFORE_INTERIM입니다', () => {
    const resignation = { leaveDate: '2026-03-30', leavingReasonCode: '11' }
    expect(checkResignation(resignation, { interimSettlementDate: '2026-03-31' })).toBe('LEAVE_DATE_BEFORE_INTERIM')
    expect(
      checkResignation({ ...resignation, leaveDate: '2026-03-31' }, { interimSettlementDate: '2026-03-31' }),
    ).not.toBe('LEAVE_DATE_BEFORE_INTERIM')
  })
})
