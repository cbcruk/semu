import { describe, expect, it } from 'vitest'
import { maskName } from './signer-verification.ts'

describe('서명자 이름 가리기(maskName)', () => {
  it('두 글자는 끝을, 세 글자 이상은 가운데를 가립니다', () => {
    expect(maskName('홍길동')).toBe('홍*동')
    expect(maskName('남궁민수')).toBe('남**수')
    expect(maskName('이훈')).toBe('이*')
  })
})
