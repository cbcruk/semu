import { Effect } from 'effect'
import { cannotFail } from '../../shared/http/versioning.ts'
import type { PermissionDenied } from '../../shared/problem/problem.ts'
import type { CurrentActor } from '../identity-access/actor.ts'
import type { Actor, Permission } from '../identity-access/actor.types.ts'
import { authorize } from '../identity-access/authorization.ts'

/**
 * 플랜·약관 없이 권한만 보는 엔드포인트의 인가입니다. 핸들러 맨 앞에서 부르고 행위자를 돌려받습니다.
 *
 * 플랜과 약관을 요구하지 않으므로 `authorize`의 나머지 거절은 일어나지 않습니다.
 */
export const requirePermission = (permission: Permission): Effect.Effect<Actor, PermissionDenied, CurrentActor> =>
  authorize({ permission }).pipe(cannotFail('EntitlementRequired'), cannotFail('TermsReagreementRequired'))
