import { Context, Effect, Layer, Option } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { RoleRepository } from '../roles/role-repository.ts'
import type { RoleNotFound } from '../roles/role.ts'
import { Sessions } from '../sessions/sessions.ts'
import { MembershipRepository } from './membership-repository.ts'
import { decideMemberAccessChange, decideMemberRemoval, type MemberAccessInput } from './membership.aggregate.ts'
import { MemberNotFound } from './membership.ts'
import type { LastAdmin, Member, Membership, OwnerImmutable } from './membership.ts'

export type { MemberAccessInput }

/** 회사 구성원 조회, 접근 수준 변경, 내보내기입니다. 세무 대리인 배정은 구성원이 아니므로 여기 나오지 않습니다. */
export class Members extends Context.Service<
  Members,
  {
    list(actor: Actor, query: PageQuery): Effect.Effect<PageOf<Member>>
    get(actor: Actor, userId: Id<'user'>): Effect.Effect<Member, MemberNotFound>
    /**
     * 구성원의 접근 수준과 권한 그룹을 바꾸고 그 사용자의 access token을 폐기합니다.
     *
     * 관리자는 권한 그룹을 갖지 않으므로 `ADMIN`이면 `roleIds`를 비웁니다.
     */
    changeAccess(
      actor: Actor,
      userId: Id<'user'>,
      input: MemberAccessInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<Member, MemberNotFound | RoleNotFound | OwnerImmutable | LastAdmin | VersionMismatch>
    /** 구성원을 회사에서 내보냅니다. 계정은 남고 그 회사로 오는 access token만 폐기합니다. */
    remove(actor: Actor, userId: Id<'user'>): Effect.Effect<void, MemberNotFound | OwnerImmutable | LastAdmin>
  }
>()('semu/identity-access/Members') {
  static readonly layer = Layer.effect(
    Members,
    Effect.gen(function* () {
      const memberships = yield* MembershipRepository
      const users = yield* UserRepository
      const roles = yield* RoleRepository
      const sessions = yield* Sessions
      const audit = yield* AuditLog

      const toMember = Effect.fn(function* (actor: Actor, membership: Membership) {
        const user = yield* users.findById(membership.userId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        const member: Member = {
          userId: membership.userId,
          email: user.email,
          name: user.name,
          access: membership.access,
          roleIds: [...membership.roleIds],
          isOwner: membership.isOwner,
          isMe: membership.userId === actor.userId,
          joinedAt: membership.joinedAt,
          version: membership.version,
        }
        return member
      })

      const find = Effect.fn(function* (actor: Actor, userId: Id<'user'>) {
        const membership = yield* memberships.find(actor.companyId, userId)
        if (Option.isNone(membership)) return yield* new MemberNotFound({})
        return membership.value
      })

      const otherAdmins = Effect.fn(function* (actor: Actor, userId: Id<'user'>) {
        const all = yield* memberships.listByCompany(actor.companyId)
        return all.filter((m) => m.access === 'ADMIN' && m.userId !== userId).length
      })

      const list = Effect.fn('Members.list')(function* (actor: Actor, query: PageQuery) {
        const all = yield* memberships.listByCompany(actor.companyId)
        const members = yield* Effect.forEach(all, (membership) => toMember(actor, membership))
        const sorted = members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId.localeCompare(b.userId))
        return paginate(sorted, (member) => `${member.joinedAt}|${member.userId}`, query, { includeTotal: true })
      })

      const get = Effect.fn('Members.get')(function* (actor: Actor, userId: Id<'user'>) {
        return yield* toMember(actor, yield* find(actor, userId))
      })

      const changeAccess = Effect.fn('Members.changeAccess')(function* (
        actor: Actor,
        userId: Id<'user'>,
        input: MemberAccessInput,
        expectedVersion: number | undefined,
      ) {
        const membership = yield* find(actor, userId)
        yield* checkVersion(membership.version, expectedVersion)
        const companyRoleIds = new Set<string>((yield* roles.listByCompany(actor.companyId)).map((role) => role.id))
        const decision = yield* Effect.fromResult(
          decideMemberAccessChange(
            membership,
            input,
            { otherAdminCount: yield* otherAdmins(actor, userId), companyRoleIds },
            actor,
          ),
        )
        yield* memberships.save(decision.membership)
        yield* sessions.invalidateAccess(userId, actor.companyId)
        for (const entry of decision.audit) yield* audit.record(entry)
        return yield* toMember(actor, decision.membership)
      })

      const remove = Effect.fn('Members.remove')(function* (actor: Actor, userId: Id<'user'>) {
        const membership = yield* find(actor, userId)
        const decision = yield* Effect.fromResult(
          decideMemberRemoval(membership, yield* otherAdmins(actor, userId), actor),
        )
        yield* memberships.remove(actor.companyId, userId)
        yield* sessions.invalidateAccess(userId, actor.companyId)
        for (const entry of decision.audit) yield* audit.record(entry)
      })

      return Members.of({ list, get, changeAccess, remove })
    }),
  )
}
