import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  interimDateRange,
  interimRejectionOf,
  laterCompletedSettlementOf,
  serviceStartDateOf,
  type SettlementFact,
} from './severance-interim.ts'

const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const OTHER = 'emp_01JBQ000000000000000000002' as Id<'employee'>
let sequence = 0
const fact = (overrides: Partial<SettlementFact>): SettlementFact => {
  sequence += 1
  return {
    id: `sev_${String(sequence).padStart(26, '0')}` as Id<'severanceSettlement'>,
    employeeId: EMPLOYEE,
    kind: 'INTERIM',
    status: 'COMPLETED',
    lastWorkDate: '2025-03-31',
    ...overrides,
  }
}

describe('serviceStartDateOf', () => {
  it('완료한 중간정산이 없으면 입사일입니다', () => {
    expect(serviceStartDateOf('2020-01-01', [], EMPLOYEE, '2026-10-31')).toBe('2020-01-01')
  })

  it('기준일 전에 완료한 마지막 중간정산의 다음 날입니다', () => {
    const settlements = [
      fact({ lastWorkDate: '2023-12-31' }),
      fact({ lastWorkDate: '2025-03-31' }),
      fact({ lastWorkDate: '2025-09-30', status: 'CALCULATED' }),
      fact({ lastWorkDate: '2025-10-31', status: 'EXCLUDED' }),
      fact({ lastWorkDate: '2026-01-31', employeeId: OTHER }),
      fact({ lastWorkDate: '2025-12-31', kind: 'RETIREMENT' }),
      fact({ lastWorkDate: '2026-10-31' }),
    ]

    expect(serviceStartDateOf('2020-01-01', settlements, EMPLOYEE, '2026-10-31')).toBe('2025-04-01')
  })

  it('이 필드 전에 저장한 정산(kind 없음)은 퇴직으로 봅니다', () => {
    const { kind: _, ...legacy } = fact({ lastWorkDate: '2025-03-31' })

    expect(serviceStartDateOf('2020-01-01', [legacy], EMPLOYEE, '2026-10-31')).toBe('2020-01-01')
  })
})

describe('interimRejectionOf', () => {
  const base = {
    retirementBenefitType: 'SEVERANCE_PAY',
    leaveDate: null,
    joinDate: '2025-01-01',
    settlementDate: '2025-12-31',
    reason: 'HOME_PURCHASE',
    settlements: [],
    employeeId: EMPLOYEE,
  } as const

  it('퇴직금 제도이고 재직 중이며 1년(365일) 이상이면 받습니다', () => {
    expect(interimRejectionOf(base)).toBeNull()
  })

  it('제도, 퇴사, 근속 1년 순으로 거절합니다', () => {
    expect(interimRejectionOf({ ...base, retirementBenefitType: 'DC', leaveDate: '2025-12-31' })).toBe(
      'NOT_SEVERANCE_PAY_PLAN',
    )
    expect(interimRejectionOf({ ...base, leaveDate: '2026-01-31' })).toBe('ALREADY_LEFT')
    expect(interimRejectionOf({ ...base, settlementDate: '2025-12-30' })).toBe('SERVICE_UNDER_ONE_YEAR')
  })

  it('전세금·보증금 사유는 제외하지 않은 같은 사유가 있으면 거절합니다', () => {
    const rent = { ...base, reason: 'RENT_DEPOSIT' } as const
    expect(
      interimRejectionOf({ ...rent, settlements: [fact({ interimReason: 'RENT_DEPOSIT', status: 'CALCULATED' })] }),
    ).toBe('RENT_DEPOSIT_ALREADY_USED')
    expect(
      interimRejectionOf({ ...rent, settlements: [fact({ interimReason: 'RENT_DEPOSIT', status: 'EXCLUDED' })] }),
    ).toBeNull()
    expect(interimRejectionOf({ ...rent, settlements: [fact({ interimReason: 'HOME_PURCHASE' })] })).toBeNull()
  })
})

describe('interimDateRange', () => {
  it('마지막 완료 중간정산 다음 날(없으면 입사일)부터 오늘까지입니다', () => {
    expect(interimDateRange('2020-01-01', [], EMPLOYEE, '2026-11-14')).toEqual({
      earliestDate: '2020-01-01',
      latestDate: '2026-11-14',
    })
    expect(interimDateRange('2020-01-01', [fact({ lastWorkDate: '2026-11-14' })], EMPLOYEE, '2026-11-14')).toEqual({
      earliestDate: '2026-11-15',
      latestDate: '2026-11-14',
    })
  })
})

describe('laterCompletedSettlementOf', () => {
  it('같은 직원의 기준일이 더 늦은 완료 정산을 찾습니다', () => {
    const target = fact({ lastWorkDate: '2025-03-31', status: 'CALCULATED' })
    const later = fact({ lastWorkDate: '2026-10-31', kind: 'RETIREMENT' })

    expect(laterCompletedSettlementOf([target, later], target)).toBe(later)
    expect(laterCompletedSettlementOf([target, { ...later, status: 'CALCULATED' }], target)).toBeUndefined()
    expect(laterCompletedSettlementOf([target, { ...later, employeeId: OTHER }], target)).toBeUndefined()
  })
})
