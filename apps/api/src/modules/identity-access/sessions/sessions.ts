import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { AccessTokens } from '../access-tokens.ts'
import type { AccessibleCompany } from '../access/actor-directory.ts'
import { ActorDirectory } from '../access/actor-directory.ts'
import { verifyPassword } from '../accounts/password-hash.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import { AccountLocked, InvalidCredentials, normalizeEmail, toUserProfile } from '../accounts/user.ts'
import type { UserRecord } from '../accounts/user.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { CompanyNotFound } from '../companies/company.ts'
import { randomSecret, sha256, splitRefreshToken } from './refresh-cookie.ts'
import { SessionRepository } from './session-repository.ts'
import { SessionInvalid } from './session.ts'
import type { SessionGrant, SessionRecord, SessionRevocation } from './session.ts'

/** access token 수명(초)입니다. `AccessTokens.layerExpiring`에 같은 값을 넣습니다. */
export const ACCESS_TOKEN_TTL_SECONDS = 600

/** `staySignedIn` 없이 로그인한 세션의 수명(초)입니다. */
export const SHORT_SESSION_SECONDS = 86_400

/** `staySignedIn`으로 로그인한 세션의 수명(초)입니다. */
export const LONG_SESSION_SECONDS = 14 * 86_400

/** 이만큼 연속으로 틀리면 계정을 잠급니다. */
export const MAX_FAILED_SIGN_INS = 5

/** 공개 데모 계정의 로그인 ID입니다. 데모 계정은 읽기만 합니다. */
export const DEMO_EMAIL = 'demo@alfred.example'

/** 발급한 세션입니다. `refreshToken`은 쿠키로만 내보냅니다. */
export interface IssuedSession {
  grant: SessionGrant
  refreshToken: string
  /** refresh 쿠키의 `Max-Age`(초)입니다. */
  refreshMaxAge: number
}

/** 로그인 입력입니다. */
export interface SignInInput {
  email: string
  password: string
  staySignedIn?: boolean | undefined
  companyId?: Id<'company'> | undefined
}

/** 로그인·토큰 갱신·회사 전환·로그아웃입니다. */
export class Sessions extends Context.Service<
  Sessions,
  {
    signIn(input: SignInInput): Effect.Effect<IssuedSession, InvalidCredentials | AccountLocked | CompanyNotFound>
    /** 공개 데모 계정으로 로그인합니다. 현행 `GET /api/member/demo/`로 비밀번호를 받아 로그인하던 두 단계를 합쳤습니다. */
    signInDemo(): Effect.Effect<IssuedSession>
    /** 비밀번호 확인 없이 세션을 엽니다. 가입·초대 수락 직후에 씁니다. */
    open(
      userId: Id<'user'>,
      options: { staySignedIn: boolean; companyId?: Id<'company'> | undefined },
    ): Effect.Effect<IssuedSession, CompanyNotFound>
    /** refresh token을 회전하고 새 access token을 줍니다. `companyId`를 주면 그 회사로 전환합니다. */
    refresh(
      refreshToken: string | undefined,
      companyId?: Id<'company'>,
    ): Effect.Effect<IssuedSession, SessionInvalid | CompanyNotFound>
    signOut(refreshToken: string | undefined): Effect.Effect<void>
    /** 사용자의 세션을 모두 폐기합니다. 비밀번호 변경·재설정에 씁니다. */
    revokeAll(userId: Id<'user'>, reason: SessionRevocation): Effect.Effect<void>
    /**
     * 사용자의 access token만 폐기합니다. 세션은 남으므로 클라이언트는 401을 받고 refresh로 새 권한을 받습니다.
     *
     * 권한 그룹·접근 수준 변경, 약관 동의처럼 행위자 계산이 바뀌는 일 뒤에 부릅니다.
     */
    invalidateAccess(userId: Id<'user'>, companyId?: Id<'company'>): Effect.Effect<void>
    /** 회사 등록용 토큰의 사용자입니다. */
    onboardingUser(token: string): Effect.Effect<Option.Option<Id<'user'>>>
  }
>()('semu/identity-access/Sessions') {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const users = yield* UserRepository
      const sessions = yield* SessionRepository
      const directory = yield* ActorDirectory
      const tokens = yield* AccessTokens
      const audit = yield* AuditLog

      const nowIso = Clock.currentTimeMillis.pipe(Effect.map((now) => new Date(now).toISOString()))

      /** 세션에 회사를 묶고 access token(회사가 없으면 onboarding token)을 발급합니다. */
      const bind = Effect.fn('Sessions.bind')(function* (
        session: SessionRecord,
        user: UserRecord,
        requested: Id<'company'> | undefined,
      ) {
        const companies = yield* directory.companiesOf(user.id)
        const chosen = chooseCompany(companies, requested, user.lastCompanyId)
        if (chosen === 'NOT_FOUND') return yield* new CompanyNotFound({})
        if (session.accessToken !== undefined) yield* tokens.revoke(session.accessToken)

        const summaries = companies.map(toCompanySummary)
        if (chosen === undefined) {
          const { accessToken: _, companyId: __, ...rest } = session
          const onboardingToken = session.onboardingToken ?? randomSecret()
          yield* sessions.save({ ...rest, onboardingToken })
          const grant: SessionGrant = { onboardingToken, user: toUserProfile(user), companies: summaries }
          return { grant }
        }

        const resolved = yield* directory.resolve(user.id, chosen.company.id)
        if (Option.isNone(resolved)) return yield* new CompanyNotFound({})
        const accessToken = yield* tokens.issue(resolved.value.actor)
        const { onboardingToken: _, ...rest } = session
        const next: SessionRecord = { ...rest, companyId: chosen.company.id, accessToken }
        yield* sessions.save(next)
        if (user.lastCompanyId !== chosen.company.id) yield* users.save({ ...user, lastCompanyId: chosen.company.id })
        const grant: SessionGrant = {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          user: toUserProfile(user),
          company: { ...toCompanySummary(chosen), plans: [...resolved.value.actor.plans] },
          companies: summaries,
        }
        return { grant }
      })

      const open = Effect.fn('Sessions.open')(function* (
        userId: Id<'user'>,
        options: { staySignedIn: boolean; companyId?: Id<'company'> | undefined },
      ) {
        const user = yield* users.findById(userId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        const now = yield* Clock.currentTimeMillis
        const lifetime = options.staySignedIn ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS
        const secret = randomSecret()
        const session: SessionRecord = {
          id: newId('session', now),
          userId,
          refreshSecretHash: sha256(secret),
          rotatedSecretHashes: [],
          staySignedIn: options.staySignedIn,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + lifetime * 1000).toISOString(),
        }
        const bound = yield* bind(session, user, options.companyId)
        return { grant: bound.grant, refreshToken: `${session.id}.${secret}`, refreshMaxAge: lifetime }
      })

      const signIn = Effect.fn('Sessions.signIn')(function* (input: SignInInput) {
        const found = yield* users.findByEmail(normalizeEmail(input.email))
        if (Option.isNone(found) || found.value.status !== 'ACTIVE' || found.value.isDemo) {
          yield* audit.record({ action: 'SIGN_IN_FAILED', detail: 'unknown or inactive account' })
          return yield* new InvalidCredentials({})
        }
        const user = found.value
        if (user.failedSignInCount >= MAX_FAILED_SIGN_INS) return yield* new AccountLocked({})
        if (!verifyPassword(input.password, user.passwordHash)) {
          const failed = user.failedSignInCount + 1
          yield* users.save({ ...user, failedSignInCount: failed })
          yield* audit.record({
            action: failed >= MAX_FAILED_SIGN_INS ? 'ACCOUNT_LOCKED' : 'SIGN_IN_FAILED',
            actorUserId: user.id,
          })
          return yield* failed >= MAX_FAILED_SIGN_INS
            ? Effect.fail(new AccountLocked({}))
            : Effect.fail(new InvalidCredentials({}))
        }
        if (user.failedSignInCount > 0) yield* users.save({ ...user, failedSignInCount: 0 })
        const issued = yield* open(user.id, { staySignedIn: input.staySignedIn ?? false, companyId: input.companyId })
        yield* audit.record({ action: 'SIGN_IN_SUCCEEDED', actorUserId: user.id, companyId: issued.grant.company?.id })
        return issued
      })

      const signInDemo = Effect.fn('Sessions.signInDemo')(function* () {
        const demo = yield* users.findByEmail(DEMO_EMAIL).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        return yield* open(demo.id, { staySignedIn: false }).pipe(Effect.orDie)
      })

      const findLive = Effect.fn('Sessions.findLive')(function* (refreshToken: string | undefined) {
        const parts = refreshToken === undefined ? undefined : splitRefreshToken(refreshToken)
        if (parts === undefined) return yield* new SessionInvalid({})
        const found = yield* sessions.findById(parts.sessionId as Id<'session'>)
        if (Option.isNone(found)) return yield* new SessionInvalid({})
        const session = found.value
        const now = yield* nowIso
        if (session.revokedAt !== undefined || session.expiresAt <= now) return yield* new SessionInvalid({})
        const hash = sha256(parts.secret)
        if (session.rotatedSecretHashes.includes(hash)) {
          yield* revoke(session, 'REFRESH_REUSED')
          yield* audit.record({ action: 'SESSION_REUSE_DETECTED', actorUserId: session.userId, targetId: session.id })
          return yield* new SessionInvalid({})
        }
        if (hash !== session.refreshSecretHash) return yield* new SessionInvalid({})
        return session
      })

      const refresh = Effect.fn('Sessions.refresh')(function* (
        refreshToken: string | undefined,
        companyId?: Id<'company'>,
      ) {
        const session = yield* findLive(refreshToken)
        const user = yield* users.findById(session.userId)
        if (Option.isNone(user) || user.value.status !== 'ACTIVE') return yield* new SessionInvalid({})
        const secret = randomSecret()
        const rotated: SessionRecord = {
          ...session,
          refreshSecretHash: sha256(secret),
          rotatedSecretHashes: [...session.rotatedSecretHashes, session.refreshSecretHash],
        }
        const bound = yield* bind(rotated, user.value, companyId ?? session.companyId)
        if (companyId !== undefined && companyId !== session.companyId) {
          yield* audit.record({
            action: 'COMPANY_SWITCHED',
            actorUserId: session.userId,
            companyId,
            actorKind: bound.grant.company?.actorKind,
          })
        }
        const remaining = Math.max(
          0,
          Math.floor((Date.parse(session.expiresAt) - (yield* Clock.currentTimeMillis)) / 1000),
        )
        return { grant: bound.grant, refreshToken: `${session.id}.${secret}`, refreshMaxAge: remaining }
      })

      const revoke = Effect.fn('Sessions.revoke')(function* (session: SessionRecord, reason: SessionRevocation) {
        if (session.accessToken !== undefined) yield* tokens.revoke(session.accessToken)
        const { accessToken: _, onboardingToken: __, ...rest } = session
        yield* sessions.save({ ...rest, revokedAt: yield* nowIso, revokedReason: reason })
      })

      const signOut = Effect.fn('Sessions.signOut')(function* (refreshToken: string | undefined) {
        const session = yield* findLive(refreshToken).pipe(Effect.option)
        if (Option.isNone(session)) return
        yield* revoke(session.value, 'SIGNED_OUT')
        yield* audit.record({
          action: 'SIGNED_OUT',
          actorUserId: session.value.userId,
          companyId: session.value.companyId,
        })
      })

      const revokeAll = Effect.fn('Sessions.revokeAll')(function* (userId: Id<'user'>, reason: SessionRevocation) {
        for (const session of yield* sessions.listActiveByUser(userId)) yield* revoke(session, reason)
      })

      const invalidateAccess = Effect.fn('Sessions.invalidateAccess')(function* (
        userId: Id<'user'>,
        companyId?: Id<'company'>,
      ) {
        for (const session of yield* sessions.listActiveByUser(userId)) {
          if (session.accessToken === undefined) continue
          if (companyId !== undefined && session.companyId !== companyId) continue
          yield* tokens.revoke(session.accessToken)
          const { accessToken: _, ...rest } = session
          yield* sessions.save(rest)
        }
      })

      const onboardingUser = (token: string) =>
        sessions.findByOnboardingToken(token).pipe(Effect.map(Option.map((session) => session.userId)))

      return Sessions.of({ signIn, signInDemo, open, refresh, signOut, revokeAll, invalidateAccess, onboardingUser })
    }),
  )
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

function toCompanySummary(entry: AccessibleCompany): SessionGrant['companies'][number] {
  return {
    id: entry.company.id,
    name: entry.company.name,
    businessType: entry.company.businessType,
    actorKind: entry.actorKind,
  }
}
