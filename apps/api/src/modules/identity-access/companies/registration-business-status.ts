import type { BusinessStatus } from './business-status-check.ts'

/** 회사 등록을 막는 사업자 상태입니다. 폐업만 막고 휴업은 허용합니다. */
const 등록을막는상태: BusinessStatus = 'CLOSED'

/**
 * 사업자 상태조회 결과로 회사 등록을 막는지입니다. `undefined`는 조회 실패입니다.
 *
 * 폐업만 막고 휴업·미등록 등 알 수 없음·조회 실패는 허용합니다. 외부 API 장애가 가입을 막지 않게 하기 위해서입니다
 * (`docs/design/rule-decisions/identity-access.md` business-number-checksum 3, 재설계 전 구현과 같음).
 *
 * @example
 * ```ts
 * isRegistrationBlocked('CLOSED') // true
 * isRegistrationBlocked('SUSPENDED') // false
 * isRegistrationBlocked(undefined) // false
 * ```
 */
export function isRegistrationBlocked(status: BusinessStatus | undefined): boolean {
  return status === 등록을막는상태
}
