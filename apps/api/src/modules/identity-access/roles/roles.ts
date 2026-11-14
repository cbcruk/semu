import { Clock, Context, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import { Sessions } from '../sessions/sessions.ts'
import { RoleRepository } from './role-repository.ts'
import { decideRoleCreation, decideRoleRemoval, decideRoleUpdate } from './role.aggregate.ts'
import { RoleNotFound } from './role.ts'
import type { PermissionNotGrantable, Role, RoleInput, RoleNameTaken, RoleRecord } from './role.ts'

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

      /** 판정이 알려 준 사용자의 access token을 폐기합니다(M5, 같은 트랜잭션). */
      const invalidate = Effect.fn(function* (actor: Actor, userIds: ReadonlyArray<Id<'user'>>) {
        for (const userId of userIds) yield* sessions.invalidateAccess(userId, actor.companyId)
      })

      const list = Effect.fn('Roles.list')(function* (actor: Actor) {
        const all = yield* roles.listByCompany(actor.companyId)
        return yield* Effect.forEach(all, toRole)
      })

      const get = Effect.fn('Roles.get')(function* (actor: Actor, roleId: Id<'role'>) {
        return yield* toRole(yield* find(actor, roleId))
      })

      const create = Effect.fn('Roles.create')(function* (actor: Actor, input: RoleInput) {
        const siblings = yield* roles.listByCompany(actor.companyId)
        const now = yield* Clock.currentTimeMillis
        const decision = yield* Effect.fromResult(
          decideRoleCreation(
            { id: newId('role', now), createdAt: new Date(now).toISOString() },
            input,
            siblings,
            actor,
          ),
        )
        yield* roles.save(decision.role)
        for (const entry of decision.audit) yield* audit.record(entry)
        return yield* toRole(decision.role)
      })

      const update = Effect.fn('Roles.update')(function* (
        actor: Actor,
        roleId: Id<'role'>,
        input: RoleInput,
        expectedVersion: number | undefined,
      ) {
        const current = yield* find(actor, roleId)
        yield* checkVersion(current.version, expectedVersion)
        const siblings = yield* roles.listByCompany(actor.companyId)
        const decision = yield* Effect.fromResult(
          decideRoleUpdate(current, input, siblings, yield* holders(actor.companyId, roleId), actor),
        )
        yield* roles.save(decision.role)
        yield* invalidate(actor, decision.invalidatedUserIds)
        for (const entry of decision.audit) yield* audit.record(entry)
        return yield* toRole(decision.role)
      })

      const remove = Effect.fn('Roles.remove')(function* (actor: Actor, roleId: Id<'role'>) {
        const role = yield* find(actor, roleId)
        const decision = decideRoleRemoval(role, yield* holders(actor.companyId, roleId), actor)
        for (const membership of decision.memberships) yield* memberships.save(membership)
        yield* invalidate(actor, decision.invalidatedUserIds)
        yield* roles.remove(actor.companyId, roleId)
        for (const entry of decision.audit) yield* audit.record(entry)
      })

      return Roles.of({ list, get, create, update, remove })
    }),
  )
}
