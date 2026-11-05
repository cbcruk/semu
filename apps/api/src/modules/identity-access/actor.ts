import { Context } from 'effect'
import type { Actor, Permission } from './actor.types.ts'

/** 지금 요청의 행위자입니다. {@link Authentication} 미들웨어가 넣습니다. */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()('semu/identity-access/CurrentActor') {}

/**
 * 행위자가 권한을 가졌는지입니다. `*`, `resource:*`, 정확히 같은 권한 중 하나가 있으면 참입니다.
 *
 * @example
 * ```ts
 * hasPermission(actor, 'employee:update') // actor.permissions에 'employee:*'가 있어도 참
 * ```
 */
export function hasPermission(actor: Pick<Actor, 'permissions'>, permission: Permission): boolean {
  if (actor.permissions.has('*') || actor.permissions.has(permission)) return true
  const resource = permission.split(':')[0]
  return actor.permissions.has(`${resource}:*`)
}
