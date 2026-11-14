import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { UserRecord } from '../accounts/user.ts'
import {
  accessInvalidations,
  agencyScopeAudit,
  bindAgency,
  bindCompany,
  bindOnboarding,
  companySwitchAudit,
  decideRefreshTokenUse,
  onboardingUserOf,
  openSession,
  planAgencyScope,
  rotateSession,
} from './session.aggregate.ts'
import type { SessionRecord } from './session.ts'

const now = Date.parse('2026-11-15T00:00:00.000Z')
const at = '2026-11-15T00:00:00.000Z'
const COMPANY = 'cmp_01JBQ00000000000000000000A' as Id<'company'>
const OTHER = 'cmp_01JBQ00000000000000000000B' as Id<'company'>

const opened = openSession({
  id: 'ses_01JBQ000000000000000000001' as Id<'session'>,
  userId: 'usr_01JBQ000000000000000000001' as Id<'user'>,
  secretHash: 's1',
  staySignedIn: false,
  now,
})
const session: SessionRecord = { ...opened.session, companyId: COMPANY, accessTokenHash: 'a1' }

const user: UserRecord = {
  id: session.userId,
  email: 'owner@example.com',
  name: '대표',
  kind: 'CLIENT',
  isDemo: false,
  passwordHash: 'hash',
  status: 'ACTIVE',
  failedSignInCount: 0,
  createdAt: at,
}

describe('세션 열기와 묶기', () => {
  it('로그인 유지가 아니면 하루짜리 세션을 엽니다', () => {
    expect(opened.lifetimeSeconds).toBe(86_400)
    expect(opened.session).toMatchObject({ rotatedSecretHashes: [], expiresAt: '2026-11-16T00:00:00.000Z' })
  })

  it('회사에 묶으면 onboarding token과 대리인 범위를 떼고 쥐고 있던 access token을 폐기합니다', () => {
    const change = bindCompany(
      { ...session, scope: 'AGENCY', onboardingTokenHash: 'o', onboardingTokenExpiresAt: at },
      OTHER,
      'a2',
    )

    expect(change).toEqual({
      session: { ...opened.session, companyId: OTHER, accessTokenHash: 'a2' },
      revokedAccessTokenHash: 'a1',
    })
  })

  it('onboarding token은 한 시간이지만 세션이 먼저 끝나면 그때까지입니다', () => {
    const soon = { ...session, expiresAt: '2026-11-15T00:30:00.000Z' }

    expect(bindOnboarding(session, 'o', now).session).toMatchObject({
      onboardingTokenExpiresAt: '2026-11-15T01:00:00.000Z',
    })
    expect(bindOnboarding(soon, 'o', now).session).not.toHaveProperty('companyId')
    expect(bindOnboarding(soon, 'o', now).session.onboardingTokenExpiresAt).toBe('2026-11-15T00:30:00.000Z')
  })

  it('고객 사용자는 대리인 범위를 쓸 수 없고, 대리인은 회사를 떼고 대리인 범위로 묶습니다', () => {
    const client = planAgencyScope(user)

    expect(Result.isFailure(client) && client.failure._tag).toBe('AgencyScopeNotAllowed')
    expect(Result.getOrThrow(planAgencyScope({ ...user, kind: 'AGENCY_STAFF' }))).toBe('AGENCY_STAFF')
    expect(bindAgency(session, 'a2').session).toMatchObject({ scope: 'AGENCY', accessTokenHash: 'a2' })
    expect(bindAgency(session, 'a2').session).not.toHaveProperty('companyId')
  })
})

describe('decideRefreshTokenUse', () => {
  it('지금 secret이면 세션을 돌려주고, 모르거나 폐기·만료된 세션은 남길 것 없이 거부합니다', () => {
    expect(Result.getOrThrow(decideRefreshTokenUse(session, 's1', at))).toBe(session)
    for (const result of [
      decideRefreshTokenUse(undefined, undefined, at),
      decideRefreshTokenUse(session, 'other', at),
      decideRefreshTokenUse({ ...session, revokedAt: at }, 's1', at),
      decideRefreshTokenUse(session, 's1', '2026-11-16T00:00:00.000Z'),
    ]) {
      expect(Result.isFailure(result) && result.failure).toEqual({
        error: expect.objectContaining({ _tag: 'SessionInvalid' }),
      })
    }
  })

  it('회전된 secret을 다시 쓰면 세션을 폐기해 남기며 거부합니다', () => {
    const { rotated } = rotateSession(session, 's2', now)
    const result = decideRefreshTokenUse(rotated, 's1', at)

    expect(Result.isFailure(result) && result.failure.keep).toEqual({
      session: expect.objectContaining({ revokedAt: at, revokedReason: 'REFRESH_REUSED' }),
      revokedAccessTokenHash: 'a1',
      audit: [{ action: 'SESSION_REUSE_DETECTED', actorUserId: session.userId, targetId: session.id }],
    })
  })
})

describe('rotateSession', () => {
  it('지금 secret을 회전 목록에 남기고 쿠키 수명은 세션의 남은 시간입니다', () => {
    const result = rotateSession(session, 's2', now + 3_600_000)

    expect(result.rotated).toMatchObject({ refreshSecretHash: 's2', rotatedSecretHashes: ['s1'] })
    expect(result.refreshMaxAge).toBe(82_800)
  })
})

describe('감사 기록과 access 폐기', () => {
  it('다른 회사로 바꿨을 때만 회사 전환을, 처음 대리인 범위에 들어올 때만 진입을 남깁니다', () => {
    expect(companySwitchAudit(session, COMPANY, 'CLIENT')).toEqual([])
    expect(companySwitchAudit(session, undefined, 'CLIENT')).toEqual([])
    expect(companySwitchAudit(session, OTHER, 'CLIENT')).toEqual([
      { action: 'COMPANY_SWITCHED', actorUserId: session.userId, companyId: OTHER, actorKind: 'CLIENT' },
    ])
    expect(agencyScopeAudit({ ...session, scope: 'AGENCY' })).toEqual([])
    expect(agencyScopeAudit(session)).toEqual([expect.objectContaining({ action: 'AGENCY_SCOPE_ENTERED' })])
  })

  it('access token이 있고 그 회사에 묶인 세션만 access token을 뗍니다', () => {
    const changes = accessInvalidations(
      [session, { ...session, companyId: OTHER, accessTokenHash: 'b1' }, { ...opened.session }],
      COMPANY,
    )

    expect(changes).toEqual([{ session: { ...opened.session, companyId: COMPANY }, revokedAccessTokenHash: 'a1' }])
  })

  it('onboarding token은 세션과 토큰이 모두 살아 있을 때만 사용자를 알려 줍니다', () => {
    const onboarding = bindOnboarding(session, 'o', now).session

    expect(onboardingUserOf(onboarding, at)).toBe(session.userId)
    expect(onboardingUserOf(onboarding, '2026-11-15T01:00:00.000Z')).toBeUndefined()
  })
})
