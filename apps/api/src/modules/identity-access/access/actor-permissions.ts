import type { GrantedPermission } from '../actor.types.ts'
import type { MemberAccess } from '../members/membership.ts'
import {
  AGENT_PERMISSIONS,
  BASE_PERMISSIONS,
  isGrantable,
  isGrantedPermission,
} from '../permissions/permission-catalog.ts'

/** 권한 계산에 쓰는 행위자의 회사 접근 방식입니다. */
export type ActorAccess =
  { kind: 'AGENCY' } | { kind: 'MEMBER'; access: MemberAccess; rolePermissions: ReadonlyArray<ReadonlyArray<string>> }

/**
 * 행위자의 권한 집합을 계산합니다. `/me`의 `permissions`와 인가가 같은 값을 씁니다.
 *
 * - 관리자는 `*`. 와일드카드라 대리인 전용 권한은 들지 않습니다
 * - 배정된 세무 대리인은 {@link AGENT_PERMISSIONS}(D5). 구성원 관리와 AI 비서는 없고 대리인 전용 권한이 있습니다.
 *   회사 범위 토큰의 대리인 행위자와 대리인 범위 토큰의 `Agent`가 이 값을 같이 씁니다
 * - 일반 사용자는 기본 권한과 권한 그룹 권한의 합집합(매뉴얼 "권한 그룹들의 메뉴를 합집합으로 접근").
 *   권한 그룹은 저장소에서 읽은 문자열이라 저장할 때와 같은 {@link isGrantable}로 다시 거릅니다. 카탈로그에 없는 값,
 *   `*`, 관리자 전용(`member:*` 등), 대리인 전용(`filing:process` 등) 권한은 저장돼 있어도 버립니다.
 *   관리자의 `*`와 대리인 권한은 권한 그룹이 아니라 위 두 갈래에서 줍니다
 *
 * @example
 * ```ts
 * actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [['employee:*']] }).has('employee:*') // true
 * ```
 */
export function actorPermissions(access: ActorAccess): ReadonlySet<GrantedPermission> {
  if (access.kind === 'AGENCY') return new Set<GrantedPermission>(AGENT_PERMISSIONS)
  if (access.access === 'ADMIN') return new Set<GrantedPermission>(['*'])
  const 권한집합 = new Set<GrantedPermission>(BASE_PERMISSIONS)
  for (const 권한그룹 of access.rolePermissions) {
    for (const 권한 of 권한그룹) if (isGrantedPermission(권한) && isGrantable(권한)) 권한집합.add(권한)
  }
  return 권한집합
}
