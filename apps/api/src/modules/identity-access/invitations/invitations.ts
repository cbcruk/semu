import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ValidationFailed } from '../../../shared/problem/problem.ts'
import { hashPassword, verifyPassword } from '../accounts/password-hash.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import { normalizeEmail, type InvalidCredentials, type PasswordPolicyViolated } from '../accounts/user.ts'
import type { UserRecord } from '../accounts/user.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog, type AuditInput } from '../audit/audit-log.ts'
import { CompanyRepository } from '../companies/company-repository.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import { Mailer } from '../notifications/mailer.ts'
import { RoleRepository } from '../roles/role-repository.ts'
import type { RoleNotFound } from '../roles/role.ts'
import { randomSecret, sha256 } from '../sessions/refresh-cookie.ts'
import { Sessions } from '../sessions/sessions.ts'
import type { IssuedSession } from '../sessions/sessions.ts'
import type { RequiredTermsMissing, TermVersionOutdated } from '../terms/term.ts'
import { Terms } from '../terms/terms.ts'
import {
  decideInvitationAcceptance,
  decideInvitationCancel,
  decideInvitationCreation,
  inviteeUser,
  planInvitationAcceptance,
} from './invitation.aggregate.ts'
import { allowedInvitationActions, invitationStatus, remainingDays } from './invitation-status.ts'
import { InvitationRepository } from './invitation-repository.ts'
import {
  InvitationNotFound,
  type InvitationAccountMismatch,
  type InvitationAlreadyPending,
  type InvitationClosed,
  type InviteeAlreadyMember,
} from './invitation.ts'
import type { Invitation, InvitationAcceptance, InvitationInput, InvitationRecord } from './invitation.ts'

/** 초대 미리보기입니다. 수락 화면이 로그인할지 가입할지 정합니다. */
export interface InvitationPreviewView {
  companyName: string
  email: string
  inviterName: string
  status: Invitation['status']
  isExistingUser: boolean
  expiresAt: string
}

/** 수락에서 날 수 있는 오류입니다. */
export type AcceptanceError =
  | InvitationNotFound
  | InvitationClosed
  | InvitationAccountMismatch
  | InvalidCredentials
  | PasswordPolicyViolated
  | ValidationFailed
  | RequiredTermsMissing
  | TermVersionOutdated

/**
 * 구성원 초대입니다. 현행 내부 초대(`/user/:id/invite/`)와 초대 수락을 하나로 묶었습니다.
 *
 * 초대 링크 토큰은 메일에만 실리고 저장소에는 SHA-256 해시만 남습니다. 30일이 지나면 만료입니다.
 */
export class Invitations extends Context.Service<
  Invitations,
  {
    list(actor: Actor): Effect.Effect<Invitation[]>
    create(
      actor: Actor,
      input: InvitationInput,
    ): Effect.Effect<Invitation, InviteeAlreadyMember | InvitationAlreadyPending | RoleNotFound>
    cancel(
      actor: Actor,
      invitationId: Id<'invitation'>,
    ): Effect.Effect<Invitation, InvitationNotFound | InvitationClosed>
    /** 링크 토큰으로 초대를 봅니다. 닫힌 초대도 상태와 함께 돌려줍니다. */
    preview(token: string): Effect.Effect<InvitationPreviewView, InvitationNotFound>
    /**
     * 초대를 수락하고 그 회사에 묶인 세션을 엽니다.
     *
     * 이미 계정이 있으면 로그인한 상태(`signedInUserId`)이거나 비밀번호를 보내야 합니다.
     * 계정이 없으면 이름·비밀번호·필수 약관 동의로 가입합니다.
     */
    accept(
      acceptance: InvitationAcceptance,
      signedInUserId: Id<'user'> | undefined,
    ): Effect.Effect<IssuedSession, AcceptanceError>
  }
>()('semu/identity-access/Invitations') {
  static readonly layer = Layer.effect(
    Invitations,
    Effect.gen(function* () {
      const invitations = yield* InvitationRepository
      const users = yield* UserRepository
      const companies = yield* CompanyRepository
      const memberships = yield* MembershipRepository
      const roles = yield* RoleRepository
      const mailer = yield* Mailer
      const sessions = yield* Sessions
      const terms = yield* Terms
      const audit = yield* AuditLog

      const view = (record: InvitationRecord, now: number): Invitation => {
        const status = invitationStatus(record.status, record.expiresAt, now)
        return {
          id: record.id,
          email: record.email,
          ...(record.name === undefined ? {} : { name: record.name }),
          access: record.access,
          roleIds: [...record.roleIds],
          status,
          ...(status === 'PENDING' ? { remainingDays: remainingDays(record.expiresAt, now) } : {}),
          invitedBy: record.invitedBy,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          allowedActions: allowedInvitationActions(status),
        }
      }

      const list = Effect.fn('Invitations.list')(function* (actor: Actor) {
        const now = yield* Clock.currentTimeMillis
        return (yield* invitations.listByCompany(actor.companyId)).map((record) => view(record, now))
      })

      const recordAll = (entries: ReadonlyArray<AuditInput>) =>
        Effect.forEach(entries, (entry) => audit.record(entry), { discard: true })

      const companyRoleIds = (companyId: Id<'company'>) =>
        Effect.map(roles.listByCompany(companyId), (all) => new Set<string>(all.map((role) => role.id)))

      const create = Effect.fn('Invitations.create')(function* (actor: Actor, input: InvitationInput) {
        const now = yield* Clock.currentTimeMillis
        const email = normalizeEmail(input.email)
        const existing = yield* users.findByEmail(email)
        const isMember = Option.isSome(existing)
          ? Option.isSome(yield* memberships.find(actor.companyId, existing.value.id))
          : false
        const sameEmail = (yield* invitations.listByCompany(actor.companyId)).filter((i) => i.email === email)
        const token = randomSecret()
        const decision = yield* Effect.fromResult(
          decideInvitationCreation(
            { id: newId('invitation', now), tokenHash: sha256(token) },
            input,
            email,
            { isMember, sameEmail, companyRoleIds: yield* companyRoleIds(actor.companyId) },
            actor,
            now,
          ),
        )
        yield* invitations.save(decision.invitation)
        const company = yield* companies.findById(actor.companyId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        yield* mailer.send({ to: email, template: 'INVITATION', token, data: { companyName: company.name } })
        yield* recordAll(decision.audit)
        return view(decision.invitation, now)
      })

      const cancel = Effect.fn('Invitations.cancel')(function* (actor: Actor, invitationId: Id<'invitation'>) {
        const now = yield* Clock.currentTimeMillis
        const found = yield* invitations.find(actor.companyId, invitationId)
        if (Option.isNone(found)) return yield* new InvitationNotFound({})
        const decision = yield* Effect.fromResult(decideInvitationCancel(found.value, actor, now))
        yield* invitations.save(decision.invitation)
        yield* recordAll(decision.audit)
        return view(decision.invitation, now)
      })

      const byToken = Effect.fn(function* (token: string) {
        const found = yield* invitations.findByTokenHash(sha256(token))
        if (Option.isNone(found)) return yield* new InvitationNotFound({})
        return found.value
      })

      const preview = Effect.fn('Invitations.preview')(function* (token: string) {
        const now = yield* Clock.currentTimeMillis
        const record = yield* byToken(token)
        const company = yield* companies
          .findById(record.companyId)
          .pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        const inviter = yield* users.findById(record.invitedBy)
        const preview: InvitationPreviewView = {
          companyName: company.name,
          email: record.email,
          inviterName: Option.match(inviter, { onNone: () => '', onSome: (user) => user.name }),
          status: invitationStatus(record.status, record.expiresAt, now),
          isExistingUser: Option.isSome(yield* users.findByEmail(record.email)),
          expiresAt: record.expiresAt,
        }
        return preview
      })

      const accept = Effect.fn('Invitations.accept')(function* (
        acceptance: InvitationAcceptance,
        signedInUserId: Id<'user'> | undefined,
      ) {
        const now = yield* Clock.currentTimeMillis
        const record = yield* byToken(acceptance.token)
        const existing = Option.getOrUndefined(yield* users.findByEmail(record.email))
        const plan = yield* Effect.fromResult(
          planInvitationAcceptance(record, existing, signedInUserId, acceptance, now),
        )
        let user: UserRecord
        let passwordMatches = true
        if (plan.kind === 'EXISTING') {
          user = plan.user
          if (plan.passwordToVerify !== undefined)
            passwordMatches = verifyPassword(plan.passwordToVerify, user.passwordHash)
        } else {
          user = inviteeUser(record, plan, {
            id: newId('user', now),
            passwordHash: hashPassword(plan.password),
            createdAt: new Date(now).toISOString(),
          })
          yield* users.save(user)
          yield* terms.recordSignup(user.id, acceptance.agreedTermIds ?? [])
        }
        const decision = yield* Effect.fromResult(
          decideInvitationAcceptance(
            record,
            {
              user,
              passwordMatches,
              isMember: Option.isSome(yield* memberships.find(record.companyId, user.id)),
              companyRoleIds: yield* companyRoleIds(record.companyId),
            },
            { membershipId: newId('membership', now), at: new Date(now).toISOString() },
          ),
        )
        if (decision.membership !== undefined) yield* memberships.save(decision.membership)
        yield* invitations.save(decision.invitation)
        yield* recordAll(decision.audit)
        yield* sessions.invalidateAccess(user.id)
        return yield* sessions.open(user.id, { staySignedIn: false, companyId: record.companyId }).pipe(Effect.orDie)
      })

      return Invitations.of({ list, create, cancel, preview, accept })
    }),
  )
}
