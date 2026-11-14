import { Context, Effect, Layer, Option, Schema } from 'effect'
import { ActorDirectory } from '../access/actor-directory.ts'
import { hashPassword, verifyPassword } from '../accounts/password-hash.ts'
import { decidePasswordChange, planPasswordChange } from '../accounts/user.aggregate.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import {
  DemoReadOnly,
  InvalidCredentials,
  PasswordPolicyViolated,
  toUserProfile,
  UserProfile,
} from '../accounts/user.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { PlanSchema } from '../companies/company.ts'
import { MemberAccess } from '../members/membership.ts'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { promotedPlans } from '../permissions/promotions.ts'
import { CompanySummary } from '../sessions/session.ts'
import { Sessions } from '../sessions/sessions.ts'

/**
 * 앱 시작 때 한 번 받는 내 정보입니다. 현행 nexus `GET /api/user/me/` + sf `GET /api/member/profile/`
 * + 회사 상세·권한·구독 병렬 조회를 하나로 합쳤습니다.
 *
 * 클라이언트는 `permissions`로 메뉴를 거르고, `promotions`로 업셀 메뉴를 그리고, `pendingTermCodes`가 있으면 약관 화면으로 보냅니다.
 */
export const Me = Schema.Struct({
  user: UserProfile,
  company: Schema.Struct({ ...CompanySummary.fields, plans: Schema.Array(PlanSchema) }),
  /** 회사 소속일 때의 접근 수준입니다. 세무 대리인으로 접근하면 없습니다. */
  membership: Schema.optionalKey(
    Schema.Struct({ access: MemberAccess, roleIds: Schema.Array(IdSchema('role')), isOwner: Schema.Boolean }),
  ),
  /** 계산된 권한입니다. `*`는 모든 권한입니다. */
  permissions: Schema.Array(Schema.String),
  /** 업셀 안내를 보여 줄 플랜입니다. */
  promotions: Schema.Array(PlanSchema),
  /** 동의해야 제품 API를 쓸 수 있는 필수 약관 코드입니다. */
  pendingTermCodes: Schema.Array(Schema.String),
  /** 새 버전이 나와 다시 물을 선택 약관 코드입니다. 막지 않습니다. */
  termCodesToReview: Schema.Array(Schema.String),
  /** 전환할 수 있는 회사입니다. */
  companies: Schema.Array(CompanySummary),
})

export type Me = typeof Me.Type

/** 로그인한 사용자 자신에 대한 작업입니다. */
export class MeService extends Context.Service<
  MeService,
  {
    profile(actor: Actor): Effect.Effect<Me>
    /** 비밀번호를 바꾸고 모든 세션을 폐기합니다. 클라이언트는 다시 로그인합니다. */
    changePassword(
      actor: Actor,
      input: { currentPassword: string; newPassword: string },
    ): Effect.Effect<void, InvalidCredentials | PasswordPolicyViolated | DemoReadOnly>
  }
>()('semu/identity-access/MeService') {
  static readonly layer = Layer.effect(
    MeService,
    Effect.gen(function* () {
      const directory = yield* ActorDirectory
      const users = yield* UserRepository
      const sessions = yield* Sessions
      const audit = yield* AuditLog

      const profile = Effect.fn('MeService.profile')(function* (actor: Actor) {
        const resolved = yield* directory
          .resolve(actor.userId, actor.companyId)
          .pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        const companies = yield* directory.companiesOf(actor.userId)
        const { company, membership, terms } = resolved
        return {
          user: toUserProfile(resolved.user),
          company: {
            id: company.id,
            name: company.name,
            businessType: company.businessType,
            actorKind: actor.kind,
            plans: [...actor.plans],
          },
          ...(membership === undefined
            ? {}
            : {
                membership: {
                  access: membership.access,
                  roleIds: [...membership.roleIds],
                  isOwner: membership.isOwner,
                },
              }),
          permissions: [...actor.permissions].sort(),
          promotions: promotedPlans({ plans: actor.plans, agencyKind: company.agency?.kind }),
          pendingTermCodes: [...actor.pendingTermCodes],
          termCodesToReview: terms.filter((entry) => entry.status === 'REVIEW').map((entry) => entry.term.code),
          companies: companies.map((entry) => ({
            id: entry.company.id,
            name: entry.company.name,
            businessType: entry.company.businessType,
            actorKind: entry.actorKind,
          })),
        } satisfies Me
      })

      const changePassword = Effect.fn('MeService.changePassword')(function* (
        actor: Actor,
        input: { currentPassword: string; newPassword: string },
      ) {
        if (actor.isDemo) return yield* new DemoReadOnly({})
        const found = Option.getOrUndefined(yield* users.findById(actor.userId))
        const user = yield* Effect.fromResult(
          planPasswordChange(
            found,
            found !== undefined && verifyPassword(input.currentPassword, found.passwordHash),
            input.newPassword,
          ),
        )
        const change = decidePasswordChange(user, hashPassword(input.newPassword), actor.companyId)
        yield* users.save(change.user)
        yield* sessions.revokeAll(actor.userId, 'PASSWORD_CHANGED')
        for (const entry of change.audit) yield* audit.record(entry)
      })

      return MeService.of({ profile, changePassword })
    }),
  )
}
