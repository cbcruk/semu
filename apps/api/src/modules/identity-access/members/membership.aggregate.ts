import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../actor.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import { RoleNotFound } from '../roles/role.ts'
import { LastAdmin, OwnerImmutable, type MemberAccess, type Membership } from './membership.ts'

/**
 * 회사 소속 애그리거트입니다(docs/design/domain-model.md). 접근 변경과 내보내기의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 회사의 다른 관리자 수("회사에 관리자가 최소 한 명", 회사 범위 불변식 M3)와 회사의 권한 그룹은 서비스가
 * 읽어 넘깁니다. 접근이 바뀌거나 내보내면 그 사용자의 access token을 같은 트랜잭션에서 폐기합니다(M5, 서비스). 버전 검사(`If-Match`)는
 * 서비스가 맡습니다.
 */

/** 접근 수준 변경 입력입니다. */
export interface MemberAccessInput {
  access: MemberAccess
  roleIds: ReadonlyArray<Id<'role'>>
}

/** 소유자는 관리자에서 내릴 수 없고, 마지막 관리자는 관리자에서 내리거나 내보낼 수 없습니다. 소유자를 먼저 봅니다. */
function checkAdminKept(
  membership: Membership,
  staysAdmin: boolean,
  otherAdminCount: number,
): Result.Result<void, OwnerImmutable | LastAdmin> {
  if (membership.isOwner && !staysAdmin) return Result.fail(new OwnerImmutable({}))
  if (membership.access === 'ADMIN' && !staysAdmin && otherAdminCount === 0) return Result.fail(new LastAdmin({}))
  return Result.void
}

/**
 * 접근 변경을 판정합니다. 관리자로 바꾸면 권한 그룹을 두지 않고, 구성원이면 겹침 없이 담은 그룹이 모두 회사에 있어야 합니다
 * (`RoleNotFound`). 감사 기록에는 접근 수준과 그룹을 남깁니다.
 */
export function decideMemberAccessChange(
  membership: Membership,
  input: MemberAccessInput,
  facts: { otherAdminCount: number; companyRoleIds: ReadonlySet<string> },
  actor: Actor,
): Result.Result<{ membership: Membership; audit: AuditInput[] }, OwnerImmutable | LastAdmin | RoleNotFound> {
  const kept = checkAdminKept(membership, input.access === 'ADMIN', facts.otherAdminCount)
  if (Result.isFailure(kept)) return Result.fail(kept.failure)
  const roleIds = input.access === 'ADMIN' ? [] : [...new Set(input.roleIds)]
  if (roleIds.some((roleId) => !facts.companyRoleIds.has(roleId))) return Result.fail(new RoleNotFound({}))
  return Result.succeed({
    membership: { ...membership, access: input.access, roleIds, version: membership.version + 1 },
    audit: [
      {
        action: 'MEMBER_ACCESS_CHANGED',
        companyId: actor.companyId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        targetId: membership.userId,
        detail: `${input.access}:${roleIds.join(',')}`,
      },
    ],
  })
}

/** 내보내기를 판정합니다. 소유자와 마지막 관리자는 내보낼 수 없습니다. */
export function decideMemberRemoval(
  membership: Membership,
  otherAdminCount: number,
  actor: Actor,
): Result.Result<{ audit: AuditInput[] }, OwnerImmutable | LastAdmin> {
  return Result.map(checkAdminKept(membership, false, otherAdminCount), () => ({
    audit: [
      {
        action: 'MEMBER_REMOVED',
        companyId: actor.companyId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        targetId: membership.userId,
      },
    ],
  }))
}
