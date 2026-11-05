import { Clock, Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import type { UserRecord } from '../accounts/user.ts'
import type { Actor, ActorKind } from '../actor.types.ts'
import { AgencyAssignmentRepository } from '../agency/agency-assignment-repository.ts'
import { CompanyRepository } from '../companies/company-repository.ts'
import type { Company } from '../companies/company.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import type { Membership } from '../members/membership.ts'
import { RoleRepository } from '../roles/role-repository.ts'
import { TermRepository } from '../terms/term-repository.ts'
import { applicablePurposes, consentStatus } from '../terms/terms-consent.ts'
import type { ConsentStatus } from '../terms/terms-consent.types.ts'
import type { Term } from '../terms/term.ts'
import { actorPermissions } from './actor-permissions.ts'
import { CompanyPlans } from './company-plans.ts'

/** 사용자가 다룰 수 있는 회사 하나입니다. 회사 전환 목록과 `/me`의 `companies`가 됩니다. */
export interface AccessibleCompany {
  company: Company
  actorKind: ActorKind
  membership?: Membership
}

/** 회사 하나에 대해 계산한 행위자와 그 근거입니다. */
export interface ResolvedActor {
  actor: Actor
  user: UserRecord
  company: Company
  membership?: Membership
  /** 지금 적용되는 약관과 사용자의 동의 상태입니다. */
  terms: ReadonlyArray<{ term: Term; status: ConsentStatus }>
}

/**
 * 사용자·회사 쌍에서 행위자를 계산합니다. 토큰을 발급할 때마다 부르므로 권한·플랜·약관 변경은 다음 발급에 반영됩니다.
 *
 * 회사 소속이면 `CLIENT`, 그 회사에 배정된 세무 대리인(팀장은 팀원 배정 포함)이면 `AGENCY`입니다. 둘 다 아니면 `None`입니다.
 */
export class ActorDirectory extends Context.Service<
  ActorDirectory,
  {
    resolve(userId: Id<'user'>, companyId: Id<'company'>): Effect.Effect<Option.Option<ResolvedActor>>
    companiesOf(userId: Id<'user'>): Effect.Effect<AccessibleCompany[]>
  }
>()('semu/identity-access/ActorDirectory') {
  static readonly layer = Layer.effect(
    ActorDirectory,
    Effect.gen(function* () {
      const users = yield* UserRepository
      const companies = yield* CompanyRepository
      const memberships = yield* MembershipRepository
      const roles = yield* RoleRepository
      const assignments = yield* AgencyAssignmentRepository
      const termRepository = yield* TermRepository
      const plansSource = yield* CompanyPlans

      const assignedCompanyIds = Effect.fn('ActorDirectory.assignedCompanyIds')(function* (user: UserRecord) {
        if (user.kind === 'CLIENT') return []
        const team = user.kind === 'AGENCY_MANAGER' ? yield* users.listByManager(user.id) : []
        return yield* assignments.companiesOf([user.id, ...team.map((member) => member.id)])
      })

      const companiesOf = Effect.fn('ActorDirectory.companiesOf')(function* (userId: Id<'user'>) {
        const user = yield* users.findById(userId)
        if (Option.isNone(user) || user.value.status !== 'ACTIVE') return []
        const result: AccessibleCompany[] = []
        for (const membership of yield* memberships.listByUser(userId)) {
          const company = yield* companies.findById(membership.companyId)
          if (Option.isSome(company)) result.push({ company: company.value, actorKind: 'CLIENT', membership })
        }
        for (const companyId of yield* assignedCompanyIds(user.value)) {
          if (result.some((entry) => entry.company.id === companyId)) continue
          const company = yield* companies.findById(companyId)
          if (Option.isSome(company)) result.push({ company: company.value, actorKind: 'AGENCY' })
        }
        return result
      })

      const resolve = Effect.fn('ActorDirectory.resolve')(function* (userId: Id<'user'>, companyId: Id<'company'>) {
        const accessible = (yield* companiesOf(userId)).find((entry) => entry.company.id === companyId)
        const user = yield* users.findById(userId)
        if (accessible === undefined || Option.isNone(user)) return Option.none<ResolvedActor>()

        const plans = yield* plansSource.plansOf(companyId)
        const membership = accessible.membership
        const rolePermissions: string[][] = []
        if (membership !== undefined) {
          for (const roleId of membership.roleIds) {
            const role = yield* roles.find(companyId, roleId)
            if (Option.isSome(role)) rolePermissions.push([...role.value.permissions])
          }
        }
        const permissions = actorPermissions(
          membership === undefined
            ? { kind: 'AGENCY' }
            : { kind: 'MEMBER', access: membership.access, rolePermissions },
        )

        const today = companyDate(yield* Clock.currentTimeMillis)
        const current = yield* termRepository.listCurrent(applicablePurposes(plans), today)
        const history = yield* termRepository.latestAgreements(userId)
        const terms = current.map((term) => ({ term, status: consentStatus(term, history.get(term.code)) }))

        const actor: Actor = {
          userId,
          companyId,
          kind: accessible.actorKind,
          permissions,
          plans,
          businessType: accessible.company.businessType,
          pendingTermCodes: terms.filter((entry) => entry.status === 'REQUIRED').map((entry) => entry.term.code),
          isDemo: user.value.isDemo,
        }
        return Option.some<ResolvedActor>({
          actor,
          user: user.value,
          company: accessible.company,
          ...(membership === undefined ? {} : { membership }),
          terms,
        })
      })

      return ActorDirectory.of({ resolve, companiesOf })
    }),
  )
}
