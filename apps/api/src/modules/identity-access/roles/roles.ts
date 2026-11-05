import { Clock, Context, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import { isGrantable } from '../permissions/permission-catalog.ts'
import { Sessions } from '../sessions/sessions.ts'
import { RoleRepository } from './role-repository.ts'
import { PermissionNotGrantable, RoleNameTaken, RoleNotFound } from './role.ts'
import type { Role, RoleInput, RoleRecord } from './role.ts'

/**
 * 권한 그룹(회사별 권한 프리셋)입니다. 구성원의 권한은 기본 권한과 부여한 그룹 권한의 합집합입니다.
 *
 * 그룹을 바꾸거나 지우면 그 그룹을 가진 구성원의 access token을 폐기해 다음 refresh에 새 권한을 받게 합니다.
 */
export class Roles extends Context.Service<
  Roles,
  {
    list(actor: Actor): Effect.Effect<Role[]>
    get(actor: Actor, roleId: Id<'role'>): Effect.Effect<Role, RoleNotFound>
    create(actor: Actor, input: RoleInput): Effect.Effect<Role, PermissionNotGrantable | RoleNameTaken>
    update(
      actor: Actor,
      roleId: Id<'role'>,
      input: RoleInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<Role, RoleNotFound | PermissionNotGrantable | RoleNameTaken | VersionMismatch>
    /** 그룹을 지우고 구성원에게서 뗍니다. 구성원이 있어도 지울 수 있습니다. */
    remove(actor: Actor, roleId: Id<'role'>): Effect.Effect<void, RoleNotFound>
  }
>()('semu/identity-access/Roles') {
  static readonly layer = Layer.effect(
    Roles,
    Effect.gen(function* () {
      const roles = yield* RoleRepository
      const memberships = yield* MembershipRepository
      const sessions = yield* Sessions
      const audit = yield* AuditLog

      const holders = Effect.fn(function* (companyId: Id<'company'>, roleId: Id<'role'>) {
        const all = yield* memberships.listByCompany(companyId)
        return all.filter((m) => m.roleIds.includes(roleId))
      })

      const toRole = Effect.fn(function* (record: RoleRecord) {
        const { companyId, ...role } = record
        const memberCount = (yield* holders(companyId, record.id)).length
        const result: Role = { ...role, memberCount }
        return result
      })

      const find = Effect.fn(function* (actor: Actor, roleId: Id<'role'>) {
        const found = yield* roles.find(actor.companyId, roleId)
        if (Option.isNone(found)) return yield* new RoleNotFound({})
        return found.value
      })

      const validate = Effect.fn(function* (actor: Actor, input: RoleInput, except?: Id<'role'>) {
        const refused = input.permissions.filter((permission) => !isGrantable(permission))
        if (refused.length > 0) return yield* new PermissionNotGrantable({ permissions: refused })
        const others = yield* roles.listByCompany(actor.companyId)
        if (others.some((role) => role.id !== except && role.name === input.name.trim())) {
          return yield* new RoleNameTaken({})
        }
      })

      const audited = (actor: Actor, action: 'ROLE_CREATED' | 'ROLE_UPDATED' | 'ROLE_DELETED', roleId: string) =>
        audit.record({
          action,
          companyId: actor.companyId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          targetId: roleId,
        })

      const invalidateHolders = Effect.fn(function* (actor: Actor, roleId: Id<'role'>) {
        for (const holder of yield* holders(actor.companyId, roleId)) {
          yield* sessions.invalidateAccess(holder.userId, actor.companyId)
        }
      })

      const list = Effect.fn('Roles.list')(function* (actor: Actor) {
        const all = yield* roles.listByCompany(actor.companyId)
        return yield* Effect.forEach(all, toRole)
      })

      const get = Effect.fn('Roles.get')(function* (actor: Actor, roleId: Id<'role'>) {
        return yield* toRole(yield* find(actor, roleId))
      })

      const create = Effect.fn('Roles.create')(function* (actor: Actor, input: RoleInput) {
        yield* validate(actor, input)
        const now = yield* Clock.currentTimeMillis
        const record: RoleRecord = {
          id: newId('role', now),
          companyId: actor.companyId,
          name: input.name.trim(),
          permissions: [...new Set(input.permissions)].sort(),
          ...(input.templateCode === undefined ? {} : { templateCode: input.templateCode }),
          createdAt: new Date(now).toISOString(),
          version: 1,
        }
        yield* roles.save(record)
        yield* audited(actor, 'ROLE_CREATED', record.id)
        return yield* toRole(record)
      })

      const update = Effect.fn('Roles.update')(function* (
        actor: Actor,
        roleId: Id<'role'>,
        input: RoleInput,
        expectedVersion: number | undefined,
      ) {
        const current = yield* find(actor, roleId)
        yield* checkVersion(current.version, expectedVersion)
        yield* validate(actor, input, roleId)
        const { templateCode: _, ...rest } = current
        const next: RoleRecord = {
          ...rest,
          name: input.name.trim(),
          permissions: [...new Set(input.permissions)].sort(),
          ...(input.templateCode === undefined ? {} : { templateCode: input.templateCode }),
          version: current.version + 1,
        }
        yield* roles.save(next)
        yield* invalidateHolders(actor, roleId)
        yield* audited(actor, 'ROLE_UPDATED', roleId)
        return yield* toRole(next)
      })

      const remove = Effect.fn('Roles.remove')(function* (actor: Actor, roleId: Id<'role'>) {
        yield* find(actor, roleId)
        for (const holder of yield* holders(actor.companyId, roleId)) {
          yield* memberships.save({
            ...holder,
            roleIds: holder.roleIds.filter((id) => id !== roleId),
            version: holder.version + 1,
          })
          yield* sessions.invalidateAccess(holder.userId, actor.companyId)
        }
        yield* roles.remove(actor.companyId, roleId)
        yield* audited(actor, 'ROLE_DELETED', roleId)
      })

      return Roles.of({ list, get, create, update, remove })
    }),
  )
}
