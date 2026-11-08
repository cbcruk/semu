import { describe, expect, it } from 'vitest'
import { maskEarnerRegistrationNumber, normalizeEarnerRegistrationNumber } from './earner-identity.ts'

describe('소득자 신원번호 정규화', () => {
  it('주민등록번호의 하이픈과 앞뒤 공백을 뺍니다', () => {
    expect(normalizeEarnerRegistrationNumber(' 900101-1234567 ', 'RESIDENT')).toBe('9001011234567')
    expect(normalizeEarnerRegistrationNumber('0501013234567', 'RESIDENT')).toBe('0501013234567')
  })

  it('1800년대 출생 자리(9·0)도 주민등록번호로 받습니다', () => {
    expect(normalizeEarnerRegistrationNumber('991231-9234567', 'RESIDENT')).toBe('9912319234567')
  })

  it('외국인등록번호는 7번째 자리가 5·6·7·8이어야 합니다', () => {
    expect(normalizeEarnerRegistrationNumber('900101-5234567', 'ALIEN')).toBe('9001015234567')
    expect(normalizeEarnerRegistrationNumber('050101-8234567', 'ALIEN')).toBe('0501018234567')
    expect(normalizeEarnerRegistrationNumber('900101-1234567', 'ALIEN')).toBeNull()
  })

  it('외국인등록번호를 주민등록번호로 넣으면 거부합니다', () => {
    expect(normalizeEarnerRegistrationNumber('900101-5234567', 'RESIDENT')).toBeNull()
  })

  it('그 세기에 없는 생년월일은 거부합니다', () => {
    expect(normalizeEarnerRegistrationNumber('901301-1234567', 'RESIDENT')).toBeNull()
    // 2000년은 윤년이라 2월 29일이 있고, 1900년은 윤년이 아니라 없습니다.
    expect(normalizeEarnerRegistrationNumber('000229-3234567', 'RESIDENT')).toBe('0002293234567')
    expect(normalizeEarnerRegistrationNumber('000229-1234567', 'RESIDENT')).toBeNull()
  })

  it('자릿수나 문자가 틀린 등록번호는 거부합니다', () => {
    expect(normalizeEarnerRegistrationNumber('900101-123456', 'RESIDENT')).toBeNull()
    expect(normalizeEarnerRegistrationNumber('900101-1******', 'RESIDENT')).toBeNull()
  })

  it('여권번호는 대문자로 바꾸고 영문·숫자 5~20자만 받습니다', () => {
    expect(normalizeEarnerRegistrationNumber(' m12345678 ', 'PASSPORT')).toBe('M12345678')
    expect(normalizeEarnerRegistrationNumber('E1234', 'PASSPORT')).toBe('E1234')
    expect(normalizeEarnerRegistrationNumber('M123', 'PASSPORT')).toBeNull()
    expect(normalizeEarnerRegistrationNumber('M1234-5678', 'PASSPORT')).toBeNull()
    expect(normalizeEarnerRegistrationNumber('M'.repeat(21), 'PASSPORT')).toBeNull()
  })
})

describe('소득자 신원번호 가리기', () => {
  it('등록번호는 생년월일과 7번째 자리만 보입니다', () => {
    expect(maskEarnerRegistrationNumber('9001011234567', 'RESIDENT')).toBe('900101-1******')
    expect(maskEarnerRegistrationNumber('9001015234567', 'ALIEN')).toBe('900101-5******')
  })

  it('여권번호는 끝 3자리만 보입니다', () => {
    expect(maskEarnerRegistrationNumber('M12345678', 'PASSPORT')).toBe('******678')
  })
})
