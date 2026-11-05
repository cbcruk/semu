import { describe, expect, it } from 'vitest'
import { contractInForce, currentWorkContract, workContractStatus } from './work-contract-period.ts'
import type { ContractPeriod } from './work-contract-period.types.ts'

const first: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2025-01-01', endDate: '2025-12-31' }
const second: ContractPeriod = { contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31' }

describe('workContractStatus', () => {
  it('is active through the end date', () => {
    expect(workContractStatus(second, '2026-12-31')).toBe('ACTIVE')
    expect(workContractStatus(second, '2027-01-01')).toBe('EXPIRED')
    expect(workContractStatus(second, '2025-12-31')).toBe('SCHEDULED')
  })
})

describe('currentWorkContract', () => {
  it('takes the latest started contract', () => {
    expect(currentWorkContract([first, second], '2026-03-01')).toBe(second)
  })

  it('falls back to the earliest upcoming one', () => {
    expect(currentWorkContract([second], '2025-06-01')).toBe(second)
  })
})

describe('contractInForce', () => {
  it('is undefined between contracts', () => {
    expect(contractInForce([first], '2026-01-01')).toBeUndefined()
  })
})
