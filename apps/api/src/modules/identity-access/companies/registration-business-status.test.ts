import { describe, expect, it } from 'vitest'
import { isRegistrationBlocked } from './registration-business-status.ts'

describe('회사 등록 전 사업자 상태 판정', () => {
  it('폐업이면 등록을 막습니다', () => {
    expect(isRegistrationBlocked('CLOSED')).toBe(true)
  })

  it.each(['ACTIVE', 'SUSPENDED', 'UNKNOWN'] as const)('%s이면 등록을 허용합니다', (status) => {
    expect(isRegistrationBlocked(status)).toBe(false)
  })

  it('조회에 실패하면 등록을 허용합니다', () => {
    expect(isRegistrationBlocked(undefined)).toBe(false)
  })
})
