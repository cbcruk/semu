import { describe, expect, it } from 'vitest'
import { contractInForce, currentWorkContract, workContractStatus } from './work-contract-period.ts'
import type { ContractPeriod } from './work-contract-period.types.ts'

const first: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2025-01-01', endDate: '2025-12-31' }
const second: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31' }

describe('근로계약 상태', () => {
  it('종료일(그날 포함)까지는 유효합니다', () => {
    expect(workContractStatus(second, '2026-12-31')).toBe('ACTIVE')
    expect(workContractStatus(second, '2027-01-01')).toBe('EXPIRED')
    expect(workContractStatus(second, '2025-12-31')).toBe('SCHEDULED')
  })
})

describe('현재 근로계약', () => {
  it('시작한 계약 중 가장 늦게 시작한 계약입니다', () => {
    expect(currentWorkContract([first, second], '2026-03-01')).toBe(second)
  })

  it('시작한 계약이 없으면 가장 먼저 시작할 예정 계약입니다', () => {
    expect(currentWorkContract([second], '2025-06-01')).toBe(second)
  })
})

describe('유효한 근로계약', () => {
  it('계약과 계약 사이의 날에는 유효한 계약이 없습니다', () => {
    expect(contractInForce([first], '2026-01-01')).toBeUndefined()
  })
})
