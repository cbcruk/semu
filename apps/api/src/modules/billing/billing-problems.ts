import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../shared/problem/problem.ts'

/** `authorize`가 낼 수 있는 오류입니다. 인증이 필요한 모든 엔드포인트의 `error`에 넣습니다. */
export const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const
