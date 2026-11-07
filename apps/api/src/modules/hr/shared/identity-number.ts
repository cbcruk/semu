import { isCalendarDate } from '../../../shared/time/date-format.ts'
import type { IdentityNumberType } from './identity-number.types.ts'

const 등록번호형식 = /^\d{6}-?\d{7}$/
const 여권번호형식 = /^[A-Z0-9]{5,20}$/

/**
 * 주민등록번호·외국인등록번호·여권번호를 저장·해시할 형태로 바꿉니다.
 *
 * 등록번호는 하이픈을 빼고 생년월일이 실제 날짜인지 확인합니다. 여권번호는 대문자로 바꿉니다.
 * 형식이 틀리면 `null`입니다.
 */
export function normalizeIdentityNumber(value: string, type: IdentityNumberType): string | null {
  const trimmed = value.trim()
  if (type === 'PASSPORT') {
    const upper = trimmed.toUpperCase()
    return 여권번호형식.test(upper) ? upper : null
  }
  if (!등록번호형식.test(trimmed)) return null
  const digits = trimmed.replace('-', '')
  return birthDateFromRegistrationNumber(digits) === null ? null : digits
}

/**
 * 주민등록번호·외국인등록번호에 담긴 생년월일입니다.
 *
 * 7번째 자리로 세기를 정합니다. 1·2·5·6은 1900년대, 3·4·7·8은 2000년대, 9·0은 1800년대입니다.
 *
 * @example
 * ```ts
 * birthDateFromRegistrationNumber('9001011234567') // '1990-01-01'
 * ```
 */
export function birthDateFromRegistrationNumber(value: string): string | null {
  const digits = value.replace('-', '')
  if (!/^\d{13}$/.test(digits)) return null
  const 성별자리 = Number(digits[6])
  const 출생세기 = [1, 2, 5, 6].includes(성별자리) ? 1900 : [3, 4, 7, 8].includes(성별자리) ? 2000 : 1800
  const 생년월일 = `${출생세기 + Number(digits.slice(0, 2))}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return isCalendarDate(생년월일) ? 생년월일 : null
}

/** 응답용 마스킹입니다. 등록번호는 `900101-1******`, 여권은 끝 3자리만 보입니다. */
export function maskIdentityNumber(normalized: string, type: IdentityNumberType): string {
  if (type === 'PASSPORT') return maskTail(normalized, 3)
  if (normalized.length !== 13) return '*'.repeat(normalized.length)
  return `${normalized.slice(0, 6)}-${normalized.slice(6, 7)}******`
}

/** 끝 `visible`자리만 남기고 가립니다. 계좌번호는 끝 4자리를 남깁니다. */
export function maskTail(value: string, visible: number): string {
  if (value.length <= visible) return value
  return '*'.repeat(value.length - visible) + value.slice(value.length - visible)
}
