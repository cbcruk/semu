import type { PasswordViolation } from './password-policy.types.ts'

/** 비밀번호 최소 길이입니다. */
export const PASSWORD_MIN_LENGTH = 8

/** 비밀번호 최대 길이입니다. */
export const PASSWORD_MAX_LENGTH = 20

/**
 * 새 비밀번호가 정책을 어기는 이유를 모두 돌려줍니다. 비어 있으면 통과입니다.
 *
 * 현행 클라이언트(B:96790-96791 `validatePasswordLength`, `validatePasswordCombination`)의
 * "8자 이상 20자 이하의 영문, 숫자 혼용"과 현행 서버의 공백 금지를 합쳤습니다. 확인 입력란은 클라이언트에만 둡니다.
 *
 * @example
 * ```ts
 * passwordViolations('abc12345') // []
 * passwordViolations('abcdefgh') // ['PASSWORD_DIGIT_REQUIRED']
 * ```
 */
export function passwordViolations(password: string): PasswordViolation[] {
  const violations: PasswordViolation[] = []
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    violations.push('PASSWORD_LENGTH')
  }
  if (!/[A-Za-z]/.test(password)) violations.push('PASSWORD_LETTER_REQUIRED')
  if (!/\d/.test(password)) violations.push('PASSWORD_DIGIT_REQUIRED')
  if (/\s/.test(password)) violations.push('PASSWORD_WHITESPACE')
  return violations
}
