import type { Permission } from '../actor.types.ts'
import type { MemberAccess } from '../members/membership.ts'
import { AGENT_PERMISSIONS, BASE_PERMISSIONS } from '../permissions/permission-catalog.ts'

/** 권한 계산에 쓰는 행위자의 회사 접근 방식입니다. */
export type ActorAccess =
  { kind: 'AGENCY' } | { kind: 'MEMBER'; access: MemberAccess; rolePermissions: ReadonlyArray<ReadonlyArray<string>> }

/**
 * 행위자의 권한 집합을 계산합니다. `/me`의 `permissions`와 인가가 같은 값을 씁니다.
 *
 * - 관리자는 `*`. 와일드카드라 대리인 전용 권한은 들지 않습니다
 * - 배정된 세무 대리인은 {@link AGENT_PERMISSIONS}(D5). 구성원 관리와 AI 비서는 없고 대리인 전용 권한이 있습니다.
 *   회사 범위 토큰의 대리인 행위자와 대리인 범위 토큰의 `Agent`가 이 값을 같이 씁니다
 * - 일반 사용자는 기본 권한과 권한 그룹 권한의 합집합(매뉴얼 "권한 그룹들의 메뉴를 합집합으로 접근")
 *
 * @example
 * ```ts
 * actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [['employee:*']] }).has('employee:*') // true
 * ```
 */
export function actorPermissions(access: ActorAccess): ReadonlySet<Permission> {
  if (access.kind === 'AGENCY') return new Set<Permission>(AGENT_PERMISSIONS)
  if (access.access === 'ADMIN') return new Set<Permission>(['*'])
  const permissions = new Set<Permission>(BASE_PERMISSIONS)
  for (const role of access.rolePermissions) for (const permission of role) permissions.add(permission as Permission)
  return permissions
}
