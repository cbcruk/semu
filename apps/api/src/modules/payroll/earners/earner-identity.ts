import { isCalendarDate } from '../../../shared/time/date-format.ts'
import type { EarnerIdentityType } from './earner-identity.types.ts'

const 등록번호형식 = /^\d{6}-?\d{7}$/
/** 나라마다 길이가 달라 영문 대문자·숫자 5~20자만 봅니다. 한국 여권은 9자입니다. */
const 여권번호형식 = /^[A-Z0-9]{5,20}$/

/** 7번째 자리(성별·세기 자리)별 출생 세기입니다. 내국인과 외국인을 이 자리로 나눕니다. */
const 내국인출생세기: Readonly<Record<string, number>> = {
  '1': 1900,
  '2': 1900,
  '3': 2000,
  '4': 2000,
  '9': 1800,
  '0': 1800,
}
const 외국인출생세기: Readonly<Record<string, number>> = { '5': 1900, '6': 1900, '7': 2000, '8': 2000 }

/** 여권번호를 가릴 때 보이는 끝자리 수입니다. HR 직원의 여권번호와 같습니다. */
const 여권번호보이는자리수 = 3

/**
 * 소득자 신원번호를 저장·해시할 형태로 바꿉니다. 형식이 틀리면 `null`입니다.
 *
 * 주민등록번호·외국인등록번호는 하이픈을 빼고, 7번째 자리가 종류와 맞는지(내국인 1·2·3·4·9·0, 외국인 5·6·7·8)와
 * 앞 6자리가 그 세기의 실제 날짜인지 봅니다. 끝자리 검증번호는 보지 않습니다. 2020년 10월부터 새로 주는 주민등록번호는
 * 검증번호 공식을 따르지 않기 때문입니다. 여권번호는 앞뒤 공백을 빼고 대문자로 바꿉니다.
 *
 * @example
 * ```ts
 * normalizeEarnerRegistrationNumber('900101-5234567', 'ALIEN') // '9001015234567'
 * normalizeEarnerRegistrationNumber('900101-1234567', 'ALIEN') // null
 * ```
 */
export function normalizeEarnerRegistrationNumber(value: string, type: EarnerIdentityType): string | null {
  const trimmed = value.trim()
  if (type === 'PASSPORT') {
    const 여권번호 = trimmed.toUpperCase()
    return 여권번호형식.test(여권번호) ? 여권번호 : null
  }
  if (!등록번호형식.test(trimmed)) return null
  const 등록번호 = trimmed.replace('-', '')
  const 출생세기 = (type === 'RESIDENT' ? 내국인출생세기 : 외국인출생세기)[등록번호.charAt(6)]
  if (출생세기 === undefined) return null
  const 생년월일 = `${출생세기 + Number(등록번호.slice(0, 2))}-${등록번호.slice(2, 4)}-${등록번호.slice(4, 6)}`
  return isCalendarDate(생년월일) ? 등록번호 : null
}

/**
 * 응답·대장 행 사본에 싣는 가린 신원번호입니다. 정규화한 값을 받습니다.
 *
 * 주민등록번호·외국인등록번호는 HR 직원과 같은 `900101-1******`이고, 여권번호는 끝 3자리만 보입니다(`******678`).
 */
export function maskEarnerRegistrationNumber(normalized: string, type: EarnerIdentityType): string {
  if (type === 'PASSPORT') {
    if (normalized.length <= 여권번호보이는자리수) return normalized
    return '*'.repeat(normalized.length - 여권번호보이는자리수) + normalized.slice(-여권번호보이는자리수)
  }
  return `${normalized.slice(0, 6)}-${normalized.charAt(6)}******`
}
