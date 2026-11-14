import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { ValidationFailed } from '../../../shared/problem/problem.ts'
import { passwordViolations } from '../accounts/password-policy.ts'
import { InvalidCredentials, PasswordPolicyViolated, type UserRecord } from '../accounts/user.ts'
import type { Actor } from '../actor.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import type { Membership } from '../members/membership.ts'
import { RoleNotFound } from '../roles/role.ts'
import {
  INVITATION_TTL_DAYS,
  invitationClosedReason,
  invitationConflict,
  invitationStatus,
} from './invitation-status.ts'
import {
  InvitationAccountMismatch,
  InvitationAlreadyPending,
  InvitationClosed,
  InviteeAlreadyMember,
  type InvitationAcceptance,
  type InvitationInput,
  type InvitationRecord,
} from './invitation.ts'

/**
 * 초대 애그리거트입니다(docs/design/domain-model.md). 생성·취소·수락의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 같은 이메일의 초대, 초대받은 사람의 소속 여부, 회사의 권한 그룹(회사 범위 불변식, M3)은 서비스가 읽어
 * 넘깁니다. 링크 토큰은 서비스가 만들고 해시만 넘기며, 메일 발송은 서비스가 저장 뒤에 합니다. 비밀번호 대조와 해시는 비싼 계산이라
 * {@link planInvitationAcceptance}가 필요하다고 할 때만 서비스가 합니다. 시각은 밀리초(`now`)로 받습니다(만료 판정).
 */

const DAY_MS = 86_400_000

function invitationAudit(
  action: 'INVITATION_CREATED' | 'INVITATION_CANCELED',
  actor: Actor,
  invitationId: string,
): AuditInput {
  return {
    action,
    companyId: actor.companyId,
    actorUserId: actor.userId,
    actorKind: actor.kind,
    targetId: invitationId,
  }
}

/** 만들 초대의 ID와 링크 토큰 해시입니다. 서비스가 정합니다. */
export interface InvitationCreation {
  id: Id<'invitation'>
  tokenHash: string
}

/** 생성 판정에 필요한 사실입니다. */
export interface InvitationCreationFacts {
  /** 그 이메일의 사용자가 이미 이 회사 소속인지입니다. */
  isMember: boolean
  /** 이 회사의 같은 이메일(정규화한) 초대입니다. */
  sameEmail: ReadonlyArray<InvitationRecord>
  /** 이 회사의 권한 그룹 ID입니다. */
  companyRoleIds: ReadonlySet<string>
}

/**
 * 생성을 판정합니다. 이미 소속이면 `InviteeAlreadyMember`, 같은 이메일로 대기 중인 초대가 있으면 `InvitationAlreadyPending`, 없는 권한
 * 그룹이면 `RoleNotFound`입니다. 관리자로 초대하면 권한 그룹을 두지 않습니다. 30일 뒤 만료합니다.
 */
export function decideInvitationCreation(
  creation: InvitationCreation,
  input: InvitationInput,
  email: string,
  facts: InvitationCreationFacts,
  actor: Actor,
  now: number,
): Result.Result<
  { invitation: InvitationRecord; audit: AuditInput[] },
  InviteeAlreadyMember | InvitationAlreadyPending | RoleNotFound
> {
  const statuses = facts.sameEmail.map((invitation) => invitationStatus(invitation.status, invitation.expiresAt, now))
  const conflict = invitationConflict({ isMember: facts.isMember, statuses })
  if (conflict === 'INVITEE_ALREADY_MEMBER') return Result.fail(new InviteeAlreadyMember({}))
  const pending = facts.sameEmail.find((_, index) => statuses[index] === 'PENDING')
  if (conflict === 'INVITATION_ALREADY_PENDING' && pending !== undefined) {
    return Result.fail(new InvitationAlreadyPending({ invitationId: pending.id }))
  }
  const roleIds = input.access === 'ADMIN' ? [] : [...new Set(input.roleIds)]
  if (roleIds.some((roleId) => !facts.companyRoleIds.has(roleId))) return Result.fail(new RoleNotFound({}))
  const invitation: InvitationRecord = {
    id: creation.id,
    companyId: actor.companyId,
    email,
    ...(input.name === undefined ? {} : { name: input.name }),
    access: input.access,
    roleIds,
    status: 'PENDING',
    tokenHash: creation.tokenHash,
    invitedBy: actor.userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITATION_TTL_DAYS * DAY_MS).toISOString(),
  }
  return Result.succeed({ invitation, audit: [invitationAudit('INVITATION_CREATED', actor, invitation.id)] })
}

/** 대기 중이 아닌(만료·취소·수락) 초대면 그 이유로 `InvitationClosed`입니다. */
function requirePending(invitation: InvitationRecord, now: number): Result.Result<void, InvitationClosed> {
  const reason = invitationClosedReason(invitationStatus(invitation.status, invitation.expiresAt, now))
  return reason === undefined ? Result.void : Result.fail(new InvitationClosed({ reason }))
}

/** 취소를 판정합니다. 대기 중일 때만 받습니다. */
export function decideInvitationCancel(
  invitation: InvitationRecord,
  actor: Actor,
  now: number,
): Result.Result<{ invitation: InvitationRecord; audit: AuditInput[] }, InvitationClosed> {
  return Result.map(requirePending(invitation, now), () => ({
    invitation: { ...invitation, status: 'CANCELED', canceledAt: new Date(now).toISOString() },
    audit: [invitationAudit('INVITATION_CANCELED', actor, invitation.id)],
  }))
}

/**
 * 수락할 사람입니다. 계정이 있으면 그 사용자이고, 로그인하지 않았으면 서비스가 `passwordToVerify`를 대조합니다. 계정이 없으면 가입할
 * 이름과 비밀번호입니다.
 */
export type InvitationAcceptancePlan =
  | { kind: 'EXISTING'; user: UserRecord; passwordToVerify?: string }
  | { kind: 'SIGN_UP'; name: string; password: string }

/**
 * 수락을 받을 수 있는지와 수락할 사람을 정합니다. 대기 중이 아니면 `InvitationClosed`입니다. 계정이 있으면 로그인한 사용자가 그 계정이어야
 * 하고(`InvitationAccountMismatch`), 로그인하지 않았으면 비밀번호가 있어야 합니다(`InvalidCredentials`). 계정이 없으면 로그인한 상태로
 * 받을 수 없고, 이름·비밀번호가 있어야 하며(`ValidationFailed`) 비밀번호가 정책을 지켜야 합니다(`PasswordPolicyViolated`).
 */
export function planInvitationAcceptance(
  invitation: InvitationRecord,
  existing: UserRecord | undefined,
  signedInUserId: Id<'user'> | undefined,
  acceptance: InvitationAcceptance,
  now: number,
): Result.Result<
  InvitationAcceptancePlan,
  InvitationClosed | InvitationAccountMismatch | InvalidCredentials | ValidationFailed | PasswordPolicyViolated
> {
  const pending = requirePending(invitation, now)
  if (Result.isFailure(pending)) return Result.fail(pending.failure)
  if (existing !== undefined) {
    if (signedInUserId !== undefined) {
      return signedInUserId === existing.id
        ? Result.succeed({ kind: 'EXISTING', user: existing })
        : Result.fail(new InvitationAccountMismatch({}))
    }
    if (acceptance.password === undefined) return Result.fail(new InvalidCredentials({}))
    return Result.succeed({ kind: 'EXISTING', user: existing, passwordToVerify: acceptance.password })
  }
  if (signedInUserId !== undefined) return Result.fail(new InvitationAccountMismatch({}))
  const { name, password } = acceptance
  if (name === undefined || password === undefined) {
    const violations = [
      ...(name === undefined ? [{ field: 'name', code: 'REQUIRED' }] : []),
      ...(password === undefined ? [{ field: 'password', code: 'REQUIRED' }] : []),
    ]
    return Result.fail(new ValidationFailed({ violations }))
  }
  const violations = passwordViolations(password)
  if (violations.length > 0) {
    return Result.fail(
      new PasswordPolicyViolated({ violations: violations.map((code) => ({ field: 'password', code })) }),
    )
  }
  return Result.succeed({ kind: 'SIGN_UP', name, password })
}

/** 초대로 가입할 사용자입니다. 고객 사용자이고 이메일은 초대의 것입니다. ID·비밀번호 해시·시각은 서비스가 정합니다. */
export function inviteeUser(
  invitation: InvitationRecord,
  plan: { name: string },
  input: { id: Id<'user'>; passwordHash: string; createdAt: string },
): UserRecord {
  return {
    id: input.id,
    email: invitation.email,
    name: plan.name,
    kind: 'CLIENT',
    isDemo: false,
    passwordHash: input.passwordHash,
    status: 'ACTIVE',
    failedSignInCount: 0,
    createdAt: input.createdAt,
  }
}

/** 수락 판정에 필요한 사실입니다. */
export interface InvitationAcceptanceFacts {
  /** 수락하는 사용자입니다. 가입했으면 방금 만든 사용자입니다. */
  user: UserRecord
  /** 비밀번호를 대조했으면 그 결과입니다. 로그인했거나 가입했으면 `true`입니다. */
  passwordMatches: boolean
  /** 그 사용자가 이미 이 회사 소속인지입니다. */
  isMember: boolean
  /** 이 회사에 남아 있는 권한 그룹 ID입니다. 초대 뒤 지운 그룹은 주지 않습니다. */
  companyRoleIds: ReadonlySet<string>
}

/**
 * 수락을 판정합니다. 대기 중이 아니면 `InvitationClosed`(계획에서 이미 봤어도 판정이 다시 지킵니다), 비밀번호가 틀리면 `InvalidCredentials`입니다. 아직 소속이 아니면 초대한 접근 수준과 남아 있는 권한 그룹으로 소속을
 * 만들고, 초대를 `ACCEPTED`로 닫습니다. 세션은 서비스가 판정 뒤에 엽니다.
 */
export function decideInvitationAcceptance(
  invitation: InvitationRecord,
  facts: InvitationAcceptanceFacts,
  input: { membershipId: Id<'membership'>; at: string },
  now: number,
): Result.Result<
  { invitation: InvitationRecord; membership?: Membership; audit: AuditInput[] },
  InvitationClosed | InvalidCredentials
> {
  const pending = requirePending(invitation, now)
  if (Result.isFailure(pending)) return Result.fail(pending.failure)
  if (!facts.passwordMatches) return Result.fail(new InvalidCredentials({}))
  const { user } = facts
  const membership: Membership | undefined = facts.isMember
    ? undefined
    : {
        id: input.membershipId,
        companyId: invitation.companyId,
        userId: user.id,
        access: invitation.access,
        roleIds: invitation.roleIds.filter((roleId) => facts.companyRoleIds.has(roleId)),
        isOwner: false,
        joinedAt: input.at,
        invitedBy: invitation.invitedBy,
        version: 1,
      }
  return Result.succeed({
    invitation: { ...invitation, status: 'ACCEPTED', acceptedAt: input.at, acceptedUserId: user.id },
    ...(membership === undefined ? {} : { membership }),
    audit: [
      {
        action: 'INVITATION_ACCEPTED',
        companyId: invitation.companyId,
        actorUserId: user.id,
        actorKind: 'CLIENT',
        targetId: invitation.id,
      },
    ],
  })
}
