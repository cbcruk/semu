import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UserRecord } from '../accounts/user.ts'
import { testActor } from '../testing.ts'
import {
  decideInvitationAcceptance,
  decideInvitationCancel,
  decideInvitationCreation,
  planInvitationAcceptance,
} from './invitation.aggregate.ts'
import type { InvitationRecord } from './invitation.ts'

const actor = testActor()
const now = Date.parse('2026-11-15T00:00:00.000Z')
const ROLE = 'rol_01JBQ000000000000000000001' as Id<'role'>
const GONE = 'rol_01JBQ000000000000000000002' as Id<'role'>
const creation = { id: 'inv_01JBQ000000000000000000001' as Id<'invitation'>, tokenHash: 'hash' }
const input = { email: 'New@Example.com', access: 'MEMBER' as const, roleIds: [ROLE, ROLE] }
const noFacts = { isMember: false, sameEmail: [], companyRoleIds: new Set<string>([ROLE]) }

const invitation = (): InvitationRecord =>
  Result.getOrThrow(decideInvitationCreation(creation, input, 'new@example.com', noFacts, actor, now)).invitation

const user: UserRecord = {
  id: 'usr_01JBQ000000000000000000009' as Id<'user'>,
  email: 'new@example.com',
  name: '새 직원',
  kind: 'CLIENT',
  isDemo: false,
  passwordHash: 'hash',
  status: 'ACTIVE',
  failedSignInCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('decideInvitationCreation', () => {
  it('권한 그룹을 겹침 없이 담아 30일 동안 대기하는 초대를 만들고 생성 감사 기록을 남깁니다', () => {
    const decision = Result.getOrThrow(
      decideInvitationCreation(creation, input, 'new@example.com', noFacts, actor, now),
    )

    expect(decision.invitation).toMatchObject({
      email: 'new@example.com',
      roleIds: [ROLE],
      status: 'PENDING',
      tokenHash: 'hash',
      expiresAt: '2026-12-15T00:00:00.000Z',
    })
    expect(decision.audit).toEqual([expect.objectContaining({ action: 'INVITATION_CREATED', targetId: creation.id })])
  })

  it('관리자로 초대하면 권한 그룹을 두지 않아 없는 그룹이어도 받습니다', () => {
    const result = decideInvitationCreation(
      creation,
      { ...input, access: 'ADMIN', roleIds: [GONE] },
      'new@example.com',
      noFacts,
      actor,
      now,
    )

    expect(Result.getOrThrow(result).invitation.roleIds).toEqual([])
  })

  it('이미 소속이면, 대기 중인 초대가 있으면, 없는 그룹이면 이 순서로 거부합니다', () => {
    const pending = invitation()
    const member = decideInvitationCreation(
      creation,
      input,
      'new@example.com',
      { ...noFacts, isMember: true, sameEmail: [pending] },
      actor,
      now,
    )
    const again = decideInvitationCreation(
      creation,
      input,
      'new@example.com',
      { ...noFacts, sameEmail: [pending] },
      actor,
      now,
    )
    const unknown = decideInvitationCreation(
      creation,
      { ...input, roleIds: [GONE] },
      'new@example.com',
      noFacts,
      actor,
      now,
    )

    expect(Result.isFailure(member) && member.failure._tag).toBe('InviteeAlreadyMember')
    expect(Result.isFailure(again) && again.failure).toMatchObject({
      _tag: 'InvitationAlreadyPending',
      invitationId: pending.id,
    })
    expect(Result.isFailure(unknown) && unknown.failure._tag).toBe('RoleNotFound')
  })
})

describe('decideInvitationCancel', () => {
  it('대기 중인 초대만 취소하고, 만료된 초대는 만료 이유로 거부합니다', () => {
    const canceled = Result.getOrThrow(decideInvitationCancel(invitation(), actor, now)).invitation
    const expired = decideInvitationCancel(invitation(), actor, Date.parse('2026-12-16T00:00:00.000Z'))

    expect(canceled).toMatchObject({ status: 'CANCELED', canceledAt: '2026-11-15T00:00:00.000Z' })
    expect(Result.isFailure(expired) && expired.failure).toMatchObject({
      _tag: 'InvitationClosed',
      reason: 'INVITATION_EXPIRED',
    })
  })
})

describe('planInvitationAcceptance', () => {
  const token = { token: 't' }

  it('계정이 있으면 로그인한 그 사용자이거나 대조할 비밀번호가 있어야 합니다', () => {
    const other = 'usr_01JBQ000000000000000000001' as Id<'user'>
    const mismatch = planInvitationAcceptance(invitation(), user, other, token, now)
    const noPassword = planInvitationAcceptance(invitation(), user, undefined, token, now)
    const withPassword = planInvitationAcceptance(invitation(), user, undefined, { ...token, password: 'pw' }, now)

    expect(Result.isFailure(mismatch) && mismatch.failure._tag).toBe('InvitationAccountMismatch')
    expect(Result.isFailure(noPassword) && noPassword.failure._tag).toBe('InvalidCredentials')
    expect(Result.getOrThrow(withPassword)).toEqual({ kind: 'EXISTING', user, passwordToVerify: 'pw' })
  })

  it('계정이 없으면 이름·비밀번호를 모두 알려 달라고 하고, 있으면 가입할 사람으로 정합니다', () => {
    const missing = planInvitationAcceptance(invitation(), undefined, undefined, token, now)
    const signUp = planInvitationAcceptance(
      invitation(),
      undefined,
      undefined,
      { ...token, name: '새 직원', password: 'Passw0rd!long' },
      now,
    )

    expect(Result.isFailure(missing) && missing.failure).toMatchObject({
      _tag: 'ValidationFailed',
      violations: [
        { field: 'name', code: 'REQUIRED' },
        { field: 'password', code: 'REQUIRED' },
      ],
    })
    expect(Result.getOrThrow(signUp)).toEqual({ kind: 'SIGN_UP', name: '새 직원', password: 'Passw0rd!long' })
  })
})

describe('decideInvitationAcceptance', () => {
  const ids = { membershipId: 'mbr_01JBQ000000000000000000009' as Id<'membership'>, at: '2026-11-16T00:00:00.000Z' }

  it('대기 중이 아닌 초대는 판정에서도 받지 않습니다', () => {
    const canceled = Result.getOrThrow(decideInvitationCancel(invitation(), actor, now)).invitation
    const result = decideInvitationAcceptance(
      canceled,
      { user, passwordMatches: true, isMember: false, companyRoleIds: new Set() },
      ids,
      now,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'InvitationClosed',
      reason: 'INVITATION_CANCELED',
    })
  })

  it('비밀번호가 틀리면 아무것도 바꾸지 않고 거부합니다', () => {
    const result = decideInvitationAcceptance(
      invitation(),
      { user, passwordMatches: false, isMember: false, companyRoleIds: new Set() },
      ids,
      now,
    )

    expect(Result.isFailure(result) && result.failure._tag).toBe('InvalidCredentials')
  })

  it('남아 있는 권한 그룹으로 소속을 만들고 초대를 닫으며, 이미 소속이면 소속은 그대로 둡니다', () => {
    const joined = Result.getOrThrow(
      decideInvitationAcceptance(
        invitation(),
        { user, passwordMatches: true, isMember: false, companyRoleIds: new Set() },
        ids,
        now,
      ),
    )
    const member = Result.getOrThrow(
      decideInvitationAcceptance(
        invitation(),
        { user, passwordMatches: true, isMember: true, companyRoleIds: new Set() },
        ids,
        now,
      ),
    )

    expect(joined.membership).toMatchObject({ userId: user.id, access: 'MEMBER', roleIds: [], invitedBy: actor.userId })
    expect(joined.invitation).toMatchObject({ status: 'ACCEPTED', acceptedUserId: user.id, acceptedAt: ids.at })
    expect(joined.audit).toEqual([expect.objectContaining({ action: 'INVITATION_ACCEPTED', actorUserId: user.id })])
    expect(member).not.toHaveProperty('membership')
  })
})
