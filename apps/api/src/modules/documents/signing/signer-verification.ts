import type { SignerVerificationOutcome } from './signer-verification.types.ts'

/** 본인확인 실패 허용 횟수입니다. 이만큼 틀리면 링크가 잠깁니다. */
export const MAX_VERIFY_FAILURES = 5

/** 본인확인 후 서명자 세션이 유지되는 시간(분)입니다. */
export const SIGNER_SESSION_MINUTES = 30

/**
 * 본인확인 시도 하나를 판정합니다.
 *
 * 이미 {@link MAX_VERIFY_FAILURES}번 틀렸으면 맞는 값이 와도 잠금입니다. 틀리면 실패 횟수를 1 올리고
 * 남은 횟수를 알려 줍니다. 맞으면 실패 횟수를 0으로 되돌립니다.
 *
 * @example 다섯 번째 실패
 * ```ts
 * decideVerification({ failures: 4, matches: false }) // { outcome: 'FAILED', failures: 5, remainingAttempts: 0 }
 * decideVerification({ failures: 5, matches: true }) // { outcome: 'LOCKED', failures: 5 }
 * ```
 */
export function decideVerification(attempt: { failures: number; matches: boolean }): SignerVerificationOutcome {
  if (attempt.failures >= MAX_VERIFY_FAILURES) return { outcome: 'LOCKED', failures: attempt.failures }
  if (!attempt.matches) {
    const failures = attempt.failures + 1
    return { outcome: 'FAILED', failures, remainingAttempts: Math.max(0, MAX_VERIFY_FAILURES - failures) }
  }
  return { outcome: 'VERIFIED', failures: 0 }
}

/**
 * 서명자가 입력한 이름·생년월일이 기대값과 같은지입니다. 이름은 앞뒤·사이 공백을 무시합니다.
 * 기대 생년월일을 모르면 이름만 비교합니다.
 */
export function identityMatches(
  expected: { name: string; birthDate?: string | undefined },
  claim: { name: string; birthDate?: string | undefined },
): boolean {
  const normalize = (name: string): string => name.replace(/\s+/g, '')
  if (normalize(expected.name) !== normalize(claim.name)) return false
  return expected.birthDate === undefined || expected.birthDate === claim.birthDate
}

/**
 * 비로그인 화면에 보일 이름입니다. 두 글자는 끝을, 세 글자 이상은 가운데를 가립니다.
 *
 * @example
 * ```ts
 * maskName('홍길동') // '홍*동'
 * ```
 */
export function maskName(name: string): string {
  const chars = [...name]
  if (chars.length <= 1) return name
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars.at(-1)}`
}
