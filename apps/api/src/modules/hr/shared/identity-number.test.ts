import { describe, expect, it } from 'vitest'
import {
  birthDateFromRegistrationNumber,
  maskIdentityNumber,
  maskTail,
  normalizeIdentityNumber,
} from './identity-number.ts'

describe('주민등록번호·여권번호 정규화', () => {
  it('등록번호의 하이픈을 뺍니다', () => {
    expect(normalizeIdentityNumber(' 900101-1234567 ', 'RRN')).toBe('9001011234567')
  })

  it('있을 수 없는 생년월일은 거부합니다', () => {
    expect(normalizeIdentityNumber('901301-1234567', 'RRN')).toBeNull()
  })

  it('여권번호는 대문자로 바꿉니다', () => {
    expect(normalizeIdentityNumber('m1234567', 'PASSPORT')).toBe('M1234567')
  })
})

describe('등록번호의 생년월일', () => {
  it('7번째 자리로 출생 세기를 정합니다', () => {
    expect(birthDateFromRegistrationNumber('0501013123456')).toBe('2005-01-01')
    expect(birthDateFromRegistrationNumber('9001012123456')).toBe('1990-01-01')
  })
})

describe('마스킹', () => {
  it('등록번호는 생년월일과 성별 자리만 보입니다', () => {
    expect(maskIdentityNumber('9001011234567', 'RRN')).toBe('900101-1******')
  })

  it('계좌번호는 끝 4자리만 보입니다', () => {
    expect(maskTail('110123456789', 4)).toBe('********6789')
  })
})
