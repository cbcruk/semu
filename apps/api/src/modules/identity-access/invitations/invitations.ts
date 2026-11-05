import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { ValidationFailed } from '../../../shared/problem/problem.ts'
import { hashPassword, verifyPassword } from '../accounts/password-hash.ts'
import { passwordViolations } from '../accounts/password-policy.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import { InvalidCredentials, normalizeEmail, PasswordPolicyViolated } from '../accounts/user.ts'
import type { UserRecord } from '../accounts/user.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { CompanyRepository } from '../companies/company-repository.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import { Mailer } from '../notifications/mailer.ts'
import { RoleRepository } from '../roles/role-repository.ts'
import { RoleNotFound } from '../roles/role.ts'
import { randomSecret, sha256 } from '../sessions/refresh-cookie.ts'
import { Sessions } from '../sessions/sessions.ts'
import type { IssuedSession } from '../sessions/sessions.ts'
import type { RequiredTermsMissing, TermVersionOutdated } from '../terms/term.ts'
import { Terms } from '../terms/terms.ts'
import {
  allowedInvitationActions,
  INVITATION_TTL_DAYS,
  invitationClosedReason,
  invitationConflict,
  invitationStatus,
  remainingDays,
} from './invitation-status.ts'
import { InvitationRepository } from './invitation-repository.ts'
import {
  InvitationAccountMismatch,
  InvitationAlreadyPending,
  InvitationClosed,
  InvitationNotFound,
  InviteeAlreadyMember,
} from './invitation.ts'
import type { Invitation, InvitationAcceptance, InvitationInput, InvitationRecord } from './invitation.ts'

const DAY_MS = 86_400_000

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

      const create = Effect.fn('Invitations.create')(function* (actor: Actor, input: InvitationInput) {
        const now = yield* Clock.currentTimeMillis
        const email = normalizeEmail(input.email)
        const existing = yield* users.findByEmail(email)
        const isMember = Option.isSome(existing)
          ? Option.isSome(yield* memberships.find(actor.companyId, existing.value.id))
          : false
        const sameEmail = (yield* invitations.listByCompany(actor.companyId)).filter((i) => i.email === email)
        const conflict = invitationConflict({
          isMember,
          statuses: sameEmail.map((i) => invitationStatus(i.status, i.expiresAt, now)),
        })
        if (conflict === 'INVITEE_ALREADY_MEMBER') return yield* new InviteeAlreadyMember({})
        const pending = sameEmail.find((i) => invitationStatus(i.status, i.expiresAt, now) === 'PENDING')
        if (conflict === 'INVITATION_ALREADY_PENDING' && pending !== undefined) {
          return yield* new InvitationAlreadyPending({ invitationId: pending.id })
        }
        const roleIds = input.access === 'ADMIN' ? [] : [...new Set(input.roleIds)]
        for (const roleId of roleIds) {
          if (Option.isNone(yield* roles.find(actor.companyId, roleId))) return yield* new RoleNotFound({})
        }
        const token = randomSecret()
        const record: InvitationRecord = {
          id: newId('invitation', now),
          companyId: actor.companyId,
          email,
          ...(input.name === undefined ? {} : { name: input.name }),
          access: input.access,
          roleIds,
          status: 'PENDING',
          tokenHash: sha256(token),
          invitedBy: actor.userId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + INVITATION_TTL_DAYS * DAY_MS).toISOString(),
        }
        yield* invitations.save(record)
        const company = yield* companies.findById(actor.companyId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        yield* mailer.send({ to: email, template: 'INVITATION', token, data: { companyName: company.name } })
        yield* audit.record({
          action: 'INVITATION_CREATED',
          companyId: actor.companyId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          targetId: record.id,
        })
        return view(record, now)
      })

      const cancel = Effect.fn('Invitations.cancel')(function* (actor: Actor, invitationId: Id<'invitation'>) {
        const now = yield* Clock.currentTimeMillis
        const found = yield* invitations.find(actor.companyId, invitationId)
        if (Option.isNone(found)) return yield* new InvitationNotFound({})
        const reason = invitationClosedReason(invitationStatus(found.value.status, found.value.expiresAt, now))
        if (reason !== undefined) return yield* new InvitationClosed({ reason })
        const next: InvitationRecord = { ...found.value, status: 'CANCELED', canceledAt: new Date(now).toISOString() }
        yield* invitations.save(next)
        yield* audit.record({
          action: 'INVITATION_CANCELED',
          companyId: actor.companyId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          targetId: invitationId,
        })
        return view(next, now)
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

      const signUp = Effect.fn(function* (record: InvitationRecord, acceptance: InvitationAcceptance, now: number) {
        if (acceptance.name === undefined || acceptance.password === undefined) {
          const violations = [
            ...(acceptance.name === undefined ? [{ field: 'name', code: 'REQUIRED' }] : []),
            ...(acceptance.password === undefined ? [{ field: 'password', code: 'REQUIRED' }] : []),
          ]
          return yield* new ValidationFailed({ violations })
        }
        const violations = passwordViolations(acceptance.password)
        if (violations.length > 0) {
          return yield* new PasswordPolicyViolated({
            violations: violations.map((code) => ({ field: 'password', code })),
          })
        }
        const user: UserRecord = {
          id: newId('user', now),
          email: record.email,
          name: acceptance.name,
          kind: 'CLIENT',
          isDemo: false,
          passwordHash: hashPassword(acceptance.password),
          status: 'ACTIVE',
          failedSignInCount: 0,
          createdAt: new Date(now).toISOString(),
        }
        yield* users.save(user)
        yield* terms.recordSignup(user.id, acceptance.agreedTermIds ?? [])
        return user
      })

      const accept = Effect.fn('Invitations.accept')(function* (
        acceptance: InvitationAcceptance,
        signedInUserId: Id<'user'> | undefined,
      ) {
        const now = yield* Clock.currentTimeMillis
        const record = yield* byToken(acceptance.token)
        const reason = invitationClosedReason(invitationStatus(record.status, record.expiresAt, now))
        if (reason !== undefined) return yield* new InvitationClosed({ reason })

        const existing = yield* users.findByEmail(record.email)
        let user: UserRecord
        if (Option.isSome(existing)) {
          user = existing.value
          if (signedInUserId !== undefined) {
            if (signedInUserId !== user.id) return yield* new InvitationAccountMismatch({})
          } else if (acceptance.password === undefined || !verifyPassword(acceptance.password, user.passwordHash)) {
            return yield* new InvalidCredentials({})
          }
        } else {
          if (signedInUserId !== undefined) return yield* new InvitationAccountMismatch({})
          user = yield* signUp(record, acceptance, now)
        }

        const nowIso = new Date(now).toISOString()
        if (Option.isNone(yield* memberships.find(record.companyId, user.id))) {
          const remaining = yield* roles.listByCompany(record.companyId)
          const roleIds = record.roleIds.filter((roleId) => remaining.some((role) => role.id === roleId))
          yield* memberships.save({
            id: newId('membership', now),
            companyId: record.companyId,
            userId: user.id,
            access: record.access,
            roleIds,
            isOwner: false,
            joinedAt: nowIso,
            invitedBy: record.invitedBy,
            version: 1,
          })
        }
        yield* invitations.save({ ...record, status: 'ACCEPTED', acceptedAt: nowIso, acceptedUserId: user.id })
        yield* audit.record({
          action: 'INVITATION_ACCEPTED',
          companyId: record.companyId,
          actorUserId: user.id,
          actorKind: 'CLIENT',
          targetId: record.id,
        })
        yield* sessions.invalidateAccess(user.id)
        return yield* sessions.open(user.id, { staySignedIn: false, companyId: record.companyId }).pipe(Effect.orDie)
      })

      return Invitations.of({ list, create, cancel, preview, accept })
    }),
  )
}
