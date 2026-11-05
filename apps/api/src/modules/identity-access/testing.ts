import type { Id } from '../../shared/ids/ids.types.ts'
import type { Actor } from './actor.types.ts'

/** 테스트용 회사 ID입니다. */
export const TEST_COMPANY_ID = 'cmp_01JBQ000000000000000000001' as Id<'company'>

/** 테스트용 사용자 ID입니다. */
export const TEST_USER_ID = 'usr_01JBQ000000000000000000001' as Id<'user'>

/**
 * 테스트용 행위자를 만듭니다. 기본값은 두 플랜을 모두 구독한 법인의 관리자이고, 약관 동의를 마친 상태입니다.
 *
 * @example 권한이 좁은 고객 사용자
 * ```ts
 * testActor({ permissions: new Set(['employee:read']) })
 * ```
 */
export function testActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: TEST_USER_ID,
    companyId: TEST_COMPANY_ID,
    kind: 'CLIENT',
    permissions: new Set(['*']),
    plans: new Set(['TAXATION', 'PAYROLL']),
    businessType: 'CORPORATION',
    pendingTermCodes: [],
    isDemo: false,
    ...overrides,
  }
}
