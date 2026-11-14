import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AccessibleCompany } from '../access/actor-directory.ts'
import { isAgentKind } from '../access/agent-directory.ts'
import type { UserRecord } from '../accounts/user.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import { AgencyScopeNotAllowed, SessionInvalid, type SessionRecord, type SessionRevocation } from './session.ts'

/**
 * 세션 애그리거트입니다(docs/design/domain-model.md). 열기·갱신(회전)·회사 전환·대리인 범위 전환·로그아웃·폐기의 판정 함수를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. secret·토큰은 서비스가 만들고 해시만 넘깁니다. access token 발급·폐기(`AccessTokens`)와 행위자
 * 계산(`ActorDirectory`)은 서비스가 하고, 판정은 폐기할 access token 해시(`revokedAccessTokenHash`)와 남길 감사 기록을 알려 줍니다.
 * 시각은 ISO 문자열(`at`) 또는 밀리초(`now`)로 받습니다.
 */

/** onboarding token(회사 등록용) 수명(초)입니다. 세션이 먼저 끝나면 그때 끝납니다. refresh하면 새로 받습니다. */
export const ONBOARDING_TOKEN_TTL_SECONDS = 3600

/** `staySignedIn` 없이 로그인한 세션의 수명(초)입니다. */
export const SHORT_SESSION_SECONDS = 86_400

/** `staySignedIn`으로 로그인한 세션의 수명(초)입니다. */
export const LONG_SESSION_SECONDS = 14 * 86_400

/** 바뀐 세션과 폐기할 access token 해시입니다. */
export interface SessionChange {
  session: SessionRecord
  /** 이 세션이 쥐고 있던 access token의 해시입니다. 서비스가 폐기합니다. */
  revokedAccessTokenHash?: string
}

/** 거부입니다. `keep`이 있으면 서비스가 저장하고 `keepChanges`를 부른 뒤 `error`로 실패합니다(M1). */
export interface SessionRejection {
  error: SessionInvalid
  keep?: SessionChange & { audit: AuditInput[] }
}

function withAccessRevoked(session: SessionRecord): SessionChange {
  return session.accessTokenHash === undefined
    ? { session }
    : { session, revokedAccessTokenHash: session.accessTokenHash }
}

/** 새 세션입니다. 로그인 유지면 14일, 아니면 1일이고 쿠키 수명도 같습니다. */
export function openSession(input: {
  id: Id<'session'>
  userId: Id<'user'>
  secretHash: string
  staySignedIn: boolean
  now: number
}): { session: SessionRecord; lifetimeSeconds: number } {
  const lifetimeSeconds = input.staySignedIn ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS
  return {
    session: {
      id: input.id,
      userId: input.userId,
      refreshSecretHash: input.secretHash,
      rotatedSecretHashes: [],
      staySignedIn: input.staySignedIn,
      createdAt: new Date(input.now).toISOString(),
      expiresAt: new Date(input.now + lifetimeSeconds * 1000).toISOString(),
    },
    lifetimeSeconds,
  }
}

/**
 * 세션을 묶을 회사를 고릅니다. 요청한 회사가 접근 목록에 없으면 `NOT_FOUND`, 다룰 회사가 없으면 `undefined`입니다.
 *
 * 현행은 쿼리(sf ID) → 쿼리(nexus ID) → 쿠키 → 마지막 회사 순이었습니다. 재설계는 요청 → 마지막으로 쓴 회사 → 가장 먼저 소속된 회사입니다.
 */
export function chooseCompany(
  companies: ReadonlyArray<AccessibleCompany>,
  requested: Id<'company'> | undefined,
  lastCompanyId: Id<'company'> | undefined,
): AccessibleCompany | 'NOT_FOUND' | undefined {
  if (requested !== undefined) return companies.find((entry) => entry.company.id === requested) ?? 'NOT_FOUND'
  return companies.find((entry) => entry.company.id === lastCompanyId) ?? companies[0]
}

/**
 * 다룰 회사가 없는 사용자의 세션에 onboarding token을 묶습니다. 회사·범위·access token을 떼고, 토큰은 1시간 또는 세션 만료 중 먼저
 * 오는 때까지입니다. 쥐고 있던 access token은 폐기합니다.
 */
export function bindOnboarding(session: SessionRecord, onboardingTokenHash: string, now: number): SessionChange {
  const { accessTokenHash: _, companyId: __, scope: ___, ...rest } = session
  const expiresAt = Math.min(now + ONBOARDING_TOKEN_TTL_SECONDS * 1000, Date.parse(session.expiresAt))
  return {
    ...withAccessRevoked(session),
    session: { ...rest, onboardingTokenHash, onboardingTokenExpiresAt: new Date(expiresAt).toISOString() },
  }
}

/** 세션을 회사에 묶고 새 access token 해시를 둡니다. onboarding token과 대리인 범위는 뗍니다. 쥐고 있던 access token은 폐기합니다. */
export function bindCompany(session: SessionRecord, companyId: Id<'company'>, accessTokenHash: string): SessionChange {
  const { onboardingTokenHash: _, onboardingTokenExpiresAt: __, scope: ___, ...rest } = session
  return { ...withAccessRevoked(session), session: { ...rest, companyId, accessTokenHash } }
}

/** 마지막으로 쓴 회사를 바꾼 사용자입니다. 같으면 `undefined`(저장하지 않음)입니다. */
export function userWithLastCompany(user: UserRecord, companyId: Id<'company'>): UserRecord | undefined {
  return user.lastCompanyId === companyId ? undefined : { ...user, lastCompanyId: companyId }
}

/** 대리인 범위를 쓸 수 있는 사용자인지 봅니다. 고객 사용자는 `AgencyScopeNotAllowed`이고 세션은 바뀌지 않습니다. */
export function planAgencyScope(
  user: UserRecord,
): Result.Result<'AGENCY_STAFF' | 'AGENCY_MANAGER', AgencyScopeNotAllowed> {
  const kind = user.kind
  return isAgentKind(kind) ? Result.succeed(kind) : Result.fail(new AgencyScopeNotAllowed({}))
}

/** 세션을 대리인 범위로 바꾸고 새 access token 해시를 둡니다. 회사와 onboarding token은 뗍니다. 쥐고 있던 access token은 폐기합니다. */
export function bindAgency(session: SessionRecord, accessTokenHash: string): SessionChange {
  const { onboardingTokenHash: _, onboardingTokenExpiresAt: __, companyId: ___, ...rest } = session
  return { ...withAccessRevoked(session), session: { ...rest, scope: 'AGENCY', accessTokenHash } }
}

/** 세션을 폐기합니다. access token과 onboarding token을 떼고 이유와 시각을 남깁니다. */
export function revokeSession(session: SessionRecord, reason: SessionRevocation, at: string): SessionChange {
  const { accessTokenHash: _, onboardingTokenHash: __, onboardingTokenExpiresAt: ___, ...rest } = session
  return { ...withAccessRevoked(session), session: { ...rest, revokedAt: at, revokedReason: reason } }
}

/**
 * refresh token으로 살아 있는 세션을 찾습니다. 세션이 없거나(토큰 모양이 틀려 `secretHash`가 없을 때도), 폐기·만료됐거나, secret이 지금 것과
 * 다르면 `SessionInvalid`입니다. 이미 회전된 secret을 다시 쓰면 탈취로 보고 세션을 폐기(`REFRESH_REUSED`)해 남기며 거부합니다(M1).
 */
export function decideRefreshTokenUse(
  found: SessionRecord | undefined,
  secretHash: string | undefined,
  at: string,
): Result.Result<SessionRecord, SessionRejection> {
  if (found === undefined || secretHash === undefined) return Result.fail({ error: new SessionInvalid({}) })
  if (found.revokedAt !== undefined || found.expiresAt <= at) return Result.fail({ error: new SessionInvalid({}) })
  if (found.rotatedSecretHashes.includes(secretHash)) {
    return Result.fail({
      error: new SessionInvalid({}),
      keep: {
        ...revokeSession(found, 'REFRESH_REUSED', at),
        audit: [{ action: 'SESSION_REUSE_DETECTED', actorUserId: found.userId, targetId: found.id }],
      },
    })
  }
  if (secretHash !== found.refreshSecretHash) return Result.fail({ error: new SessionInvalid({}) })
  return Result.succeed(found)
}

/** 세션의 사용자가 활성이어야 갱신합니다. */
export function requireActiveUser(user: UserRecord | undefined): Result.Result<UserRecord, SessionInvalid> {
  return user === undefined || user.status !== 'ACTIVE' ? Result.fail(new SessionInvalid({})) : Result.succeed(user)
}

/** refresh secret을 회전합니다. 지금 secret은 재사용 감지를 위해 남깁니다. 쿠키 수명은 세션의 남은 시간(초)입니다. */
export function rotateSession(
  session: SessionRecord,
  secretHash: string,
  now: number,
): { rotated: SessionRecord; refreshMaxAge: number } {
  return {
    rotated: {
      ...session,
      refreshSecretHash: secretHash,
      rotatedSecretHashes: [...session.rotatedSecretHashes, session.refreshSecretHash],
    },
    refreshMaxAge: Math.max(0, Math.floor((Date.parse(session.expiresAt) - now) / 1000)),
  }
}

/** 다른 회사로 전환했으면 `COMPANY_SWITCHED` 감사 기록입니다. 같은 회사를 다시 고르거나 회사를 주지 않았으면 남기지 않습니다. */
export function companySwitchAudit(
  session: SessionRecord,
  companyId: Id<'company'> | undefined,
  actorKind: 'CLIENT' | 'AGENCY' | undefined,
): AuditInput[] {
  return companyId === undefined || companyId === session.companyId
    ? []
    : [{ action: 'COMPANY_SWITCHED', actorUserId: session.userId, companyId, actorKind }]
}

/** 대리인 범위로 처음 들어왔으면 `AGENCY_SCOPE_ENTERED` 감사 기록입니다. 이미 대리인 범위였으면 남기지 않습니다. */
export function agencyScopeAudit(session: SessionRecord): AuditInput[] {
  return session.scope === 'AGENCY'
    ? []
    : [{ action: 'AGENCY_SCOPE_ENTERED', actorUserId: session.userId, actorKind: 'AGENCY' }]
}

/** 로그아웃입니다. 세션을 폐기(`SIGNED_OUT`)하고 감사 기록을 남깁니다. */
export function decideSignOut(session: SessionRecord, at: string): SessionChange & { audit: AuditInput[] } {
  return {
    ...revokeSession(session, 'SIGNED_OUT', at),
    audit: [{ action: 'SIGNED_OUT', actorUserId: session.userId, companyId: session.companyId }],
  }
}

/**
 * access token만 폐기할 세션입니다. 세션은 남으므로 클라이언트는 refresh로 새 권한을 받습니다. `companyId`를 주면 그 회사에 묶인 세션만
 * 입니다. access token이 없는 세션은 건너뜁니다.
 */
export function accessInvalidations(
  sessions: ReadonlyArray<SessionRecord>,
  companyId: Id<'company'> | undefined,
): SessionChange[] {
  return sessions.flatMap((session) => {
    if (session.accessTokenHash === undefined) return []
    if (companyId !== undefined && session.companyId !== companyId) return []
    const { accessTokenHash, ...rest } = session
    return [{ session: rest, revokedAccessTokenHash: accessTokenHash }]
  })
}

/** onboarding token의 사용자입니다. 세션과 토큰이 모두 살아 있을 때만입니다. */
export function onboardingUserOf(session: SessionRecord, at: string): Id<'user'> | undefined {
  const expired =
    session.expiresAt <= at || session.onboardingTokenExpiresAt === undefined || session.onboardingTokenExpiresAt <= at
  return expired ? undefined : session.userId
}

/** 회사 등록에 쓴 onboarding token을 지운 세션입니다. 같은 토큰으로 회사를 또 등록하지 못합니다. 세션은 남습니다. */
export function consumeOnboarding(session: SessionRecord): SessionRecord {
  const { onboardingTokenHash: _, onboardingTokenExpiresAt: __, ...rest } = session
  return rest
}
