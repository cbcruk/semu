import { describe, expect, it } from 'vitest'
import { isSeveranceSettled } from './retirement-rules.ts'

describe('isSeveranceSettled', () => {
  it('정산이 없으면 막지 않습니다', () => {
    expect(isSeveranceSettled([])).toBe(false)
  })

  it('계산됨·제외만 있으면 막지 않습니다', () => {
    expect(isSeveranceSettled(['CALCULATED', 'EXCLUDED'])).toBe(false)
  })

  it('정산 중 하나라도 지급 완료면 막습니다', () => {
    expect(isSeveranceSettled(['EXCLUDED', 'COMPLETED'])).toBe(true)
  })
})
