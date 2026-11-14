import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { Clock, Context, Effect, Layer, Option, Result } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { AccessTokens, hashAccessToken } from '../access-tokens.ts'
import type { AccessibleCompany } from '../access/actor-directory.ts'
import { ActorDirectory } from '../access/actor-directory.ts'
import { verifyPassword } from '../accounts/password-hash.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import {
  decideSignIn,
  decideSignInSucceeded,
  planSignIn,
  type UserChange,
  type UserRejection,
} from '../accounts/user.aggregate.ts'
import { AccountLocked, InvalidCredentials, normalizeEmail, toUserProfile } from '../accounts/user.ts'
import type { UserRecord } from '../accounts/user.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { CompanyNotFound } from '../companies/company.ts'
import { randomSecret, sha256, splitRefreshToken } from './refresh-cookie.ts'
import {
  accessInvalidations,
  agencyScopeAudit,
  bindAgency,
  bindCompany,
  bindOnboarding,
  chooseCompany,
  companySwitchAudit,
  consumeOnboarding,
  decideRefreshTokenUse,
  decideSignOut,
  onboardingUserOf,
  openSession,
  planAgencyScope,
  requireActiveUser,
  revokeSession,
  rotateSession,
  userWithLastCompany,
  type SessionChange,
} from './session.aggregate.ts'
import { SessionRepository } from './session-repository.ts'
import { AgencyScopeNotAllowed, SessionInvalid } from './session.ts'
import type { SessionGrant, SessionRecord, SessionRevocation } from './session.ts'

/** access token 수명(초)입니다. `AccessTokens.layerExpiring`에 같은 값을 넣습니다. */
export const ACCESS_TOKEN_TTL_SECONDS = 600

export { MAX_FAILED_SIGN_INS } from '../accounts/user.aggregate.ts'
export {
  chooseCompany,
  LONG_SESSION_SECONDS,
  ONBOARDING_TOKEN_TTL_SECONDS,
  SHORT_SESSION_SECONDS,
} from './session.aggregate.ts'

/** 공개 데모 계정의 로그인 ID입니다. 데모 계정은 읽기만 합니다. */
export const DEMO_EMAIL = 'demo@semu.example'

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
    /**
     * refresh token을 회전하고 대리인 범위 access token을 줍니다. 이후 refresh도 회사로 전환하기 전까지 대리인 범위입니다.
     *
     * 고객 사용자는 403 `AGENCY_SCOPE_NOT_ALLOWED`이고 세션은 바뀌지 않습니다.
     */
    switchToAgency(
      refreshToken: string | undefined,
    ): Effect.Effect<IssuedSession, SessionInvalid | AgencyScopeNotAllowed>
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
    /** 회사 등록에 쓴 onboarding token을 지웁니다. 같은 토큰으로 회사를 또 등록하지 못합니다. 세션은 남습니다. */
    consumeOnboardingToken(token: string): Effect.Effect<void>
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

      /** 판정이 정한 세션을 저장합니다. 쥐고 있던 access token을 먼저 폐기합니다. */
      const saveSession = Effect.fn('Sessions.saveSession')(function* (change: SessionChange) {
        if (change.revokedAccessTokenHash !== undefined) yield* tokens.revokeHash(change.revokedAccessTokenHash)
        yield* sessions.save(change.session)
      })

      /** 세션에 회사를 묶고 access token(회사가 없으면 onboarding token)을 발급합니다. */
      const bind = Effect.fn('Sessions.bind')(function* (
        session: SessionRecord,
        user: UserRecord,
        requested: Id<'company'> | undefined,
      ) {
        const companies = yield* directory.companiesOf(user.id)
        const chosen = chooseCompany(companies, requested, user.lastCompanyId)
        if (chosen === 'NOT_FOUND') return yield* new CompanyNotFound({})

        const summaries = companies.map(toCompanySummary)
        if (chosen === undefined) {
          const onboardingToken = randomSecret()
          yield* saveSession(bindOnboarding(session, sha256(onboardingToken), yield* Clock.currentTimeMillis))
          const grant: SessionGrant = { onboardingToken, user: toUserProfile(user), companies: summaries }
          return { grant }
        }

        const resolved = yield* directory.resolve(user.id, chosen.company.id)
        if (Option.isNone(resolved)) return yield* new CompanyNotFound({})
        const accessToken = yield* tokens.issue(resolved.value.actor)
        yield* saveSession(bindCompany(session, chosen.company.id, hashAccessToken(accessToken)))
        const lastCompany = userWithLastCompany(user, chosen.company.id)
        if (lastCompany !== undefined) yield* users.save(lastCompany)
        const grant: SessionGrant = {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          scope: 'COMPANY',
          user: toUserProfile(user),
          company: { ...toCompanySummary(chosen), plans: [...resolved.value.actor.plans] },
          companies: summaries,
        }
        return { grant }
      })

      /** 세션을 대리인 범위로 바꾸고 대리인 범위 access token을 발급합니다. 담당 회사는 토큰에 넣지 않습니다. */
      const bindAgencyScope = Effect.fn('Sessions.bindAgencyScope')(function* (
        session: SessionRecord,
        user: UserRecord,
      ) {
        const userKind = yield* Effect.fromResult(planAgencyScope(user))
        const accessToken = yield* tokens.issueAgency({ scope: 'AGENCY', userId: user.id, userKind })
        yield* saveSession(bindAgency(session, hashAccessToken(accessToken)))
        const companies = yield* directory.companiesOf(user.id)
        const grant: SessionGrant = {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          scope: 'AGENCY',
          user: toUserProfile(user),
          companies: companies.map(toCompanySummary),
        }
        return { grant }
      })

      const open = Effect.fn('Sessions.open')(function* (
        userId: Id<'user'>,
        options: { staySignedIn: boolean; companyId?: Id<'company'> | undefined },
      ) {
        const user = yield* users.findById(userId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        const now = yield* Clock.currentTimeMillis
        const secret = randomSecret()
        const { session, lifetimeSeconds } = openSession({
          id: newId('session', now),
          userId,
          secretHash: sha256(secret),
          staySignedIn: options.staySignedIn,
          now,
        })
        const bound = yield* bind(session, user, options.companyId)
        return { grant: bound.grant, refreshToken: `${session.id}.${secret}`, refreshMaxAge: lifetimeSeconds }
      })

      /** 판정이 남기라는 사용자 변경과 감사 기록을 저장합니다. */
      const applyUserChange = Effect.fn('Sessions.applyUserChange')(function* (change: UserChange) {
        if (change.user !== undefined) yield* users.save(change.user)
        for (const entry of change.audit) yield* audit.record(entry)
      })

      /** 거부를 돌려줍니다. 남길 것이 있으면 저장하고 실패 응답에도 커밋합니다(M1). */
      const reject = <E>(rejection: UserRejection<E>) =>
        Effect.gen(function* () {
          if (rejection.keep !== undefined) {
            yield* applyUserChange(rejection.keep)
            yield* keepChanges
          }
          return yield* Effect.fail(rejection.error)
        })

      const signIn = Effect.fn('Sessions.signIn')(function* (input: SignInInput) {
        const planned = planSignIn(Option.getOrUndefined(yield* users.findByEmail(normalizeEmail(input.email))))
        if (Result.isFailure(planned)) return yield* reject(planned.failure)
        const user = planned.success
        const decided = decideSignIn(user, verifyPassword(input.password, user.passwordHash))
        if (Result.isFailure(decided)) return yield* reject(decided.failure)
        yield* applyUserChange(decided.success)
        const issued = yield* open(user.id, { staySignedIn: input.staySignedIn ?? false, companyId: input.companyId })
        for (const entry of decideSignInSucceeded(user, issued.grant.company?.id)) yield* audit.record(entry)
        return issued
      })

      const signInDemo = Effect.fn('Sessions.signInDemo')(function* () {
        const demo = yield* users.findByEmail(DEMO_EMAIL).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
        return yield* open(demo.id, { staySignedIn: false }).pipe(Effect.orDie)
      })

      const findLive = Effect.fn('Sessions.findLive')(function* (refreshToken: string | undefined) {
        const parts = refreshToken === undefined ? undefined : splitRefreshToken(refreshToken)
        const found =
          parts === undefined
            ? undefined
            : Option.getOrUndefined(yield* sessions.findById(parts.sessionId as Id<'session'>))
        const decided = decideRefreshTokenUse(
          found,
          parts === undefined || found === undefined ? undefined : sha256(parts.secret),
          yield* nowIso,
        )
        if (Result.isSuccess(decided)) return decided.success
        const { error, keep } = decided.failure
        if (keep !== undefined) {
          // 회전된 secret의 재사용은 실패 응답과 함께 세션 폐기를 남깁니다(M1).
          yield* saveSession(keep)
          for (const entry of keep.audit) yield* audit.record(entry)
          yield* keepChanges
        }
        return yield* Effect.fail(error)
      })

      /** 살아 있는 세션의 refresh token을 회전한 값과 그 사용자입니다. 저장은 범위를 묶을 때 합니다. */
      const rotate = Effect.fn('Sessions.rotate')(function* (refreshToken: string | undefined) {
        const session = yield* findLive(refreshToken)
        const user = yield* Effect.fromResult(
          requireActiveUser(Option.getOrUndefined(yield* users.findById(session.userId))),
        )
        const secret = randomSecret()
        const { rotated, refreshMaxAge } = rotateSession(session, sha256(secret), yield* Clock.currentTimeMillis)
        return { session, rotated, user, refreshToken: `${session.id}.${secret}`, refreshMaxAge }
      })

      const refresh = Effect.fn('Sessions.refresh')(function* (
        refreshToken: string | undefined,
        companyId?: Id<'company'>,
      ) {
        const { session, rotated, user, ...cookie } = yield* rotate(refreshToken)
        if (companyId === undefined && session.scope === 'AGENCY') {
          const bound = yield* bindAgencyScope(rotated, user).pipe(
            Effect.catchTag('AgencyScopeNotAllowed', () => bind(rotated, user, undefined)),
          )
          return { grant: bound.grant, ...cookie }
        }
        const bound = yield* bind(rotated, user, companyId ?? session.companyId)
        for (const entry of companySwitchAudit(session, companyId, bound.grant.company?.actorKind)) {
          yield* audit.record(entry)
        }
        return { grant: bound.grant, ...cookie }
      })

      const switchToAgency = Effect.fn('Sessions.switchToAgency')(function* (refreshToken: string | undefined) {
        const { session, rotated, user, ...cookie } = yield* rotate(refreshToken)
        const bound = yield* bindAgencyScope(rotated, user)
        for (const entry of agencyScopeAudit(session)) yield* audit.record(entry)
        return { grant: bound.grant, ...cookie }
      })

      const signOut = Effect.fn('Sessions.signOut')(function* (refreshToken: string | undefined) {
        const session = yield* findLive(refreshToken).pipe(Effect.option)
        if (Option.isNone(session)) return
        const decision = decideSignOut(session.value, yield* nowIso)
        yield* saveSession(decision)
        for (const entry of decision.audit) yield* audit.record(entry)
      })

      const revokeAll = Effect.fn('Sessions.revokeAll')(function* (userId: Id<'user'>, reason: SessionRevocation) {
        const at = yield* nowIso
        for (const session of yield* sessions.listActiveByUser(userId)) {
          yield* saveSession(revokeSession(session, reason, at))
        }
      })

      const invalidateAccess = Effect.fn('Sessions.invalidateAccess')(function* (
        userId: Id<'user'>,
        companyId?: Id<'company'>,
      ) {
        for (const change of accessInvalidations(yield* sessions.listActiveByUser(userId), companyId)) {
          yield* saveSession(change)
        }
      })

      /** 해시가 같고, 세션과 토큰이 모두 살아 있을 때만 사용자를 돌려줍니다. */
      const onboardingUser = Effect.fn('Sessions.onboardingUser')(function* (token: string) {
        const found = yield* sessions.findByOnboardingTokenHash(sha256(token))
        if (Option.isNone(found)) return Option.none<Id<'user'>>()
        return Option.fromUndefinedOr(onboardingUserOf(found.value, yield* nowIso))
      })

      const consumeOnboardingToken = Effect.fn('Sessions.consumeOnboardingToken')(function* (token: string) {
        const found = yield* sessions.findByOnboardingTokenHash(sha256(token))
        if (Option.isNone(found)) return
        yield* sessions.save(consumeOnboarding(found.value))
      })

      return Sessions.of({
        signIn,
        signInDemo,
        open,
        refresh,
        switchToAgency,
        signOut,
        revokeAll,
        invalidateAccess,
        onboardingUser,
        consumeOnboardingToken,
      })
    }),
  )
}

function toCompanySummary(entry: AccessibleCompany): SessionGrant['companies'][number] {
  return {
    id: entry.company.id,
    name: entry.company.name,
    businessType: entry.company.businessType,
    actorKind: entry.actorKind,
  }
}
