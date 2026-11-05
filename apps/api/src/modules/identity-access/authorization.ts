import { Effect } from 'effect'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../shared/problem/problem.ts'
import { CurrentActor, hasPermission } from './actor.ts'
import type { Actor, Permission, Plan } from './actor.types.ts'

/** 엔드포인트가 선언하는 접근 요건입니다. */
export interface AccessRequirement {
  permission: Permission
  /** 이 중 하나라도 구독하면 됩니다. 비어 있거나 없으면 플랜을 보지 않습니다. */
  plans?: ReadonlyArray<Plan>
  /** 고객이 필수 약관에 동의했어야 하는지입니다. 세무 대리인은 이 검사를 건너뜁니다. */
  requiresTerms?: boolean
}

/** 접근을 거절한 이유입니다. */
export type AccessDenied = PermissionDenied | EntitlementRequired | TermsReagreementRequired

/**
 * 행위자가 요건을 모두 갖췄는지 판정합니다. 검사 순서는 플랜, 권한, 약관, 데모 쓰기입니다.
 *
 * 플랜을 먼저 보는 이유는 권한이 있어도 구독이 없으면 업셀 화면을 보여야 하기 때문입니다.
 * 데모 계정은 `:read`가 아닌 권한을 쓰는 요청을 모두 거절합니다.
 */
export function decideAccess(actor: Actor, requirement: AccessRequirement): AccessDenied | undefined {
  const plans = requirement.plans ?? []
  if (plans.length > 0 && !plans.some((plan) => actor.plans.has(plan))) {
    return new EntitlementRequired({ requiredPlans: [...plans] })
  }
  if (!hasPermission(actor, requirement.permission)) {
    return new PermissionDenied({ permission: requirement.permission })
  }
  if (requirement.requiresTerms === true && actor.kind === 'CLIENT' && actor.pendingTermCodes.length > 0) {
    return new TermsReagreementRequired({ termCodes: [...actor.pendingTermCodes] })
  }
  if (actor.isDemo && !requirement.permission.endsWith(':read')) {
    return new PermissionDenied({ permission: requirement.permission })
  }
  return undefined
}

/**
 * 지금 행위자가 요건을 갖췄는지 확인하고 행위자를 돌려줍니다. 핸들러 맨 앞에서 부릅니다.
 *
 * @example 직원 수정 핸들러
 * ```ts
 * const actor = yield* authorize({ permission: 'employee:update', plans: ['PAYROLL'] })
 * ```
 */
export const authorize = (requirement: AccessRequirement): Effect.Effect<Actor, AccessDenied, CurrentActor> =>
  Effect.flatMap(CurrentActor, (actor) => {
    const denied = decideAccess(actor, requirement)
    return denied === undefined ? Effect.succeed(actor) : Effect.fail(denied)
  })
