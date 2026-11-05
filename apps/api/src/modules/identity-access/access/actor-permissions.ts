import type { Permission } from '../actor.types.ts'
import type { MemberAccess } from '../members/membership.ts'
import { BASE_PERMISSIONS } from '../permissions/permission-catalog.ts'

/** 권한 계산에 쓰는 행위자의 회사 접근 방식입니다. */
export type ActorAccess =
  { kind: 'AGENCY' } | { kind: 'MEMBER'; access: MemberAccess; rolePermissions: ReadonlyArray<ReadonlyArray<string>> }

/**
 * 행위자의 권한 집합을 계산합니다. `/me`의 `permissions`와 인가가 같은 값을 씁니다.
 *
 * - 배정된 세무 대리인과 관리자는 `*`
 * - 일반 사용자는 기본 권한과 권한 그룹 권한의 합집합(매뉴얼 "권한 그룹들의 메뉴를 합집합으로 접근")
 *
 * @example
 * ```ts
 * actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [['employee:*']] }).has('employee:*') // true
 * ```
 */
export function actorPermissions(access: ActorAccess): ReadonlySet<Permission> {
  if (access.kind === 'AGENCY' || access.access === 'ADMIN') return new Set<Permission>(['*'])
  const permissions = new Set<Permission>(BASE_PERMISSIONS)
  for (const role of access.rolePermissions) for (const permission of role) permissions.add(permission as Permission)
  return permissions
}
