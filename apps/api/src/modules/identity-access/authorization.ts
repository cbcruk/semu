import { Effect } from 'effect'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../shared/problem/problem.ts'
import { CurrentActor, CurrentAgent, hasPermission } from './actor.ts'
import type { Actor, Agent, AgentCompany, Permission, Plan } from './actor.types.ts'

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

/** 대리인 범위 엔드포인트가 선언하는 접근 요건입니다. 약관 게이트는 대리인에게 적용하지 않습니다. */
export interface AgencyAccessRequirement {
  permission: Permission
  /** 이 중 하나라도 구독하는 회사만 남깁니다. 비어 있거나 없으면 플랜을 보지 않습니다. */
  plans?: ReadonlyArray<Plan>
}

/** 대리인 범위 인가를 통과한 결과입니다. `companies`는 요건을 갖춘 담당 회사만입니다. */
export interface AgencyScope {
  agent: Agent
  companies: ReadonlyArray<AgentCompany>
}

/**
 * 대리인이 요건을 갖췄는지 확인하고, 요건의 플랜을 구독하는 담당 회사만 돌려줍니다. `/agency/*` 핸들러 맨 앞에서 부릅니다.
 *
 * 회사 범위의 {@link authorize}와 달리 플랜이 없는 회사는 오류가 아니라 목록에서 빠집니다. 여러 회사를 가로지르는 목록이라
 * 한 회사의 구독 때문에 전체를 거절하지 않습니다. 권한은 회사 범위의 대리인 행위자와 같은 표(`AGENT_PERMISSIONS`, D5)로 봅니다.
 *
 * @example 담당 회사의 신고 건 큐
 * ```ts
 * const { companies } = yield* authorizeAgency({ permission: 'filing:read', plans: ['TAXATION'] })
 * ```
 */
export const authorizeAgency = (
  requirement: AgencyAccessRequirement,
): Effect.Effect<AgencyScope, PermissionDenied, CurrentAgent> =>
  Effect.flatMap(CurrentAgent, (agent) => {
    if (!hasPermission(agent, requirement.permission)) {
      return Effect.fail(new PermissionDenied({ permission: requirement.permission }))
    }
    const plans = requirement.plans ?? []
    const companies =
      plans.length === 0
        ? agent.companies
        : agent.companies.filter((company) => plans.some((plan) => company.plans.has(plan)))
    return Effect.succeed({ agent, companies })
  })
