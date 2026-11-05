import { describe, expect, it } from 'vitest'
import { maskName } from './signer-verification.ts'

describe('maskName', () => {
  it('hides the middle of a name', () => {
    expect(maskName('홍길동')).toBe('홍*동')
    expect(maskName('남궁민수')).toBe('남**수')
    expect(maskName('이훈')).toBe('이*')
  })
})
