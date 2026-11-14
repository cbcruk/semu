import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../actor.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import type { Membership } from '../members/membership.ts'
import { isGrantable } from '../permissions/permission-catalog.ts'
import { PermissionNotGrantable, RoleNameTaken, type RoleInput, type RoleRecord } from './role.ts'

/**
 * 권한 그룹 애그리거트입니다(docs/design/domain-model.md). 생성·수정·삭제의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 같은 회사의 권한 그룹(이름이 겹치지 않음, 회사 범위 불변식 M3)과 그 그룹을 가진 소속은 서비스가 읽어
 * 넘깁니다. 그룹을 바꾸거나 지우면 그 그룹을 가진 사용자의 access token을 폐기해야 하므로 판정이 그 사용자를 알려 주고, 서비스가 같은
 * 트랜잭션에서 폐기합니다(M5). 버전 검사(`If-Match`)는 서비스가 맡습니다.
 */

type RoleAuditAction = 'ROLE_CREATED' | 'ROLE_UPDATED' | 'ROLE_DELETED'

function roleAudit(actor: Actor, action: RoleAuditAction, roleId: string): AuditInput {
  return { action, companyId: actor.companyId, actorUserId: actor.userId, actorKind: actor.kind, targetId: roleId }
}

/** 줄 수 있는 권한만 담았는지, 자기 자신을 뺀 같은 회사 그룹과 이름이 겹치지 않는지 봅니다. 권한을 먼저 봅니다. */
function checkRoleInput(
  input: RoleInput,
  siblings: ReadonlyArray<RoleRecord>,
  except?: Id<'role'>,
): Result.Result<void, PermissionNotGrantable | RoleNameTaken> {
  const refused = input.permissions.filter((permission) => !isGrantable(permission))
  if (refused.length > 0) return Result.fail(new PermissionNotGrantable({ permissions: refused }))
  if (siblings.some((role) => role.id !== except && role.name === input.name.trim())) {
    return Result.fail(new RoleNameTaken({}))
  }
  return Result.void
}

/** 저장할 권한 목록입니다. 겹친 것을 빼고 정렬합니다. */
function normalizedPermissions(input: RoleInput): string[] {
  return [...new Set(input.permissions)].sort()
}

/** 만들 그룹의 ID와 시각입니다. 서비스가 정합니다. */
export interface RoleCreation {
  id: Id<'role'>
  createdAt: string
}

/** 생성을 판정합니다. */
export function decideRoleCreation(
  creation: RoleCreation,
  input: RoleInput,
  siblings: ReadonlyArray<RoleRecord>,
  actor: Actor,
): Result.Result<{ role: RoleRecord; audit: AuditInput[] }, PermissionNotGrantable | RoleNameTaken> {
  return Result.map(checkRoleInput(input, siblings), () => ({
    role: {
      id: creation.id,
      companyId: actor.companyId,
      name: input.name.trim(),
      permissions: normalizedPermissions(input),
      ...(input.templateCode === undefined ? {} : { templateCode: input.templateCode }),
      createdAt: creation.createdAt,
      version: 1,
    },
    audit: [roleAudit(actor, 'ROLE_CREATED', creation.id)],
  }))
}

/** 수정을 판정합니다. 템플릿 코드는 보낸 것으로 바꾸거나 지웁니다. 그룹을 가진 사용자의 access token을 폐기합니다. */
export function decideRoleUpdate(
  role: RoleRecord,
  input: RoleInput,
  siblings: ReadonlyArray<RoleRecord>,
  holders: ReadonlyArray<Membership>,
  actor: Actor,
): Result.Result<
  { role: RoleRecord; invalidatedUserIds: Id<'user'>[]; audit: AuditInput[] },
  PermissionNotGrantable | RoleNameTaken
> {
  return Result.map(checkRoleInput(input, siblings, role.id), () => {
    const { templateCode: _, ...rest } = role
    return {
      role: {
        ...rest,
        name: input.name.trim(),
        permissions: normalizedPermissions(input),
        ...(input.templateCode === undefined ? {} : { templateCode: input.templateCode }),
        version: role.version + 1,
      },
      invalidatedUserIds: holders.map((holder) => holder.userId),
      audit: [roleAudit(actor, 'ROLE_UPDATED', role.id)],
    }
  })
}

/** 삭제를 판정합니다. 구성원이 있어도 지울 수 있고, 그 소속에서 그룹을 떼며 access token을 폐기합니다. */
export function decideRoleRemoval(
  role: RoleRecord,
  holders: ReadonlyArray<Membership>,
  actor: Actor,
): { memberships: Membership[]; invalidatedUserIds: Id<'user'>[]; audit: AuditInput[] } {
  return {
    memberships: holders.map((holder) => ({
      ...holder,
      roleIds: holder.roleIds.filter((id) => id !== role.id),
      version: holder.version + 1,
    })),
    invalidatedUserIds: holders.map((holder) => holder.userId),
    audit: [roleAudit(actor, 'ROLE_DELETED', role.id)],
  }
}
