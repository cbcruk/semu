import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import type { Permission, Plan } from '../../identity-access/actor.types.ts'
import type { AccessRequirement } from '../../identity-access/authorization.ts'

/** 인사 기능을 쓰는 플랜입니다. 급여·세무 중 하나만 구독해도 됩니다. */
export const HR_PLANS: ReadonlyArray<Plan> = ['PAYROLL', 'TAXATION']

/** 인증이 필요한 모든 인사 엔드포인트가 선언하는 접근 오류입니다. */
export const ACCESS_ERRORS = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/** 인사 엔드포인트의 접근 요건입니다. 약관 동의가 필요합니다. */
export function hrAccess(permission: Permission): AccessRequirement {
  return { permission, plans: HR_PLANS, requiresTerms: true }
}
