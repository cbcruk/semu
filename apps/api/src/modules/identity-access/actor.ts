import { Context } from 'effect'
import type { Actor, Agent, Permission } from './actor.types.ts'
import { isAgentOnly, permissionResource } from './permissions/permission-catalog.ts'

/** 지금 요청의 행위자입니다. {@link Authentication} 미들웨어가 넣습니다. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()('semu/identity-access/CurrentActor') {}

/** 지금 대리인 범위 요청의 대리인입니다. `AgencyAuthentication` 미들웨어가 요청마다 담당 회사를 계산해 넣습니다. */
export class CurrentAgent extends Context.Service<CurrentAgent, Agent>()('semu/identity-access/CurrentAgent') {}

/**
 * 행위자가 권한을 가졌는지입니다. `*`, `resource:*`, 정확히 같은 권한 중 하나가 있으면 참입니다.
 *
 * 대리인 전용 권한(카탈로그의 `agentOnly`, 예: `filing:process`)은 와일드카드로 덮이지 않고 정확히 같은 권한만 인정합니다.
 * 회사 범위 행위자(`Actor`)와 대리인 범위 행위자(`Agent`)가 같은 규칙을 씁니다.
 *
 * @example
 * ```ts
 * hasPermission(actor, 'employee:update') // actor.permissions에 'employee:*'가 있어도 참
 * hasPermission(admin, 'filing:process') // 관리자의 '*'로는 거짓
 * ```
 */
export function hasPermission(actor: Pick<Actor, 'permissions'>, permission: Permission): boolean {
  if (actor.permissions.has(permission)) return true
  if (isAgentOnly(permission)) return false
  if (actor.permissions.has('*')) return true
  return actor.permissions.has(`${permissionResource(permission)}:*`)
}
