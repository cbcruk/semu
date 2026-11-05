import { sign } from 'hono/jwt'
import type { AuthUser, ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, notFound } from '../../../lib/domain-error'
import { loadAccessContext } from '../../access/access-directory'
import { USER_TYPE } from '../../access/user-type'
import { findCompany } from '../../companies/companies.repository'
import type { OneTimeTokenRow } from '../accounts/accounts.types'
import { consumeOneTimeToken, findOneTimeToken, issueOneTimeToken } from '../accounts/one-time-tokens.repository'
import { findUser, findUserByEmail, findUserBySocial, listMembershipSummaries, touchLastLogin, updatePasswordHash } from '../accounts/users.repository'
import type { SocialProvider } from '../adapters/social-login.adapter'
import type { PlatformDeps } from '../platform.types'
import { addSeconds, epochSeconds, isBefore, maskEmail, randomToken, sha256Hex } from '../platform.utils'
import type { CompanyJwtClaims, IssuedSession, UserRow } from './auth.types'
import { assertNewPassword, hashPassword, verifyPassword } from './password.utils'
import { insertSession, revokeUserSessions } from './sessions.repository'

const DAY_SECONDS = 86_400
const SHORT_SESSION_SECONDS = DAY_SECONDS
const LONG_SESSION_SECONDS = 14 * DAY_SECONDS
const JWT_TTL_SECONDS = 3_600
const PASSWORD_RESET_TTL_SECONDS = 30 * 60
const SOCIAL_SIGNUP_TTL_SECONDS = 30 * 60

/** Client details recorded with a new session. */
export interface SessionClient {
  userAgent: string | null
  ip: string | null
}

/** Outcome of `POST /api/login/social/`, matching the legacy status strings. */
export type SocialLoginResult =
  | { status: 'existed_user' | 'complete_registration'; user: UserRow; session: IssuedSession }
  | { status: 'need_to_registration'; email: string | null; signupToken: string }
  | { status: 'duplicated_company'; email: string }

/** Creates a session for a user and returns the secrets for the cookies. */
export function createSession(deps: ServiceDeps, userId: string, staySignedIn: boolean, client: SessionClient): IssuedSession {
  const now = deps.clock.now()
  const token = randomToken()
  const csrfToken = randomToken(24)
  const expiresAt = addSeconds(now, staySignedIn ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS)
  insertSession(deps.db, {
    id: sha256Hex(token),
    user_id: userId,
    csrf_token: csrfToken,
    stay_signed_in: staySignedIn ? 1 : 0,
    user_agent: client.userAgent,
    ip: client.ip,
    created_at: now,
    expires_at: expiresAt,
    revoked_at: null,
  })
  touchLastLogin(deps.db, userId, now)
  return { token, csrfToken, staySignedIn, expiresAt }
}

/**
 * Checks an email and password and opens a session.
 *
 * @throws {DomainError} `INVALID_CREDENTIALS` without revealing whether the email exists.
 */
export function login(
  deps: ServiceDeps,
  input: { email: string; password: string; staySignedIn: boolean },
  client: SessionClient,
): { user: UserRow; session: IssuedSession } {
  const user = findUserByEmail(deps.db, input.email)
  if (user === undefined || user.is_active !== 1 || !verifyPassword(input.password, user.password_hash)) {
    throw new DomainError('INVALID_CREDENTIALS', 'The email or password is incorrect.')
  }
  return { user, session: createSession(deps, user.id, input.staySignedIn, client) }
}

/**
 * Exchanges a Kakao authorization code and signs the user in when the account is known.
 *
 * Unknown accounts get a short-lived `signup_token` for
 * `POST /api/signup/user/email/:token/`. An email already used by an account
 * that is not linked to Kakao is not linked automatically.
 *
 * @throws {DomainError} `INVALID_CREDENTIALS` when the provider rejects the code.
 */
export async function socialLogin(deps: PlatformDeps, provider: SocialProvider, code: string, client: SessionClient): Promise<SocialLoginResult> {
  const profile = await deps.socialLogin.exchangeCode(provider, code)
  if (profile === null) throw new DomainError('INVALID_CREDENTIALS', 'The social login code is invalid or expired.')
  const linked = findUserBySocial(deps.db, provider, profile.providerUid)
  if (linked !== undefined && linked.is_active === 1) {
    const hasCompany = listMembershipSummaries(deps.db, linked.id).length > 0
    return { status: hasCompany ? 'existed_user' : 'complete_registration', user: linked, session: createSession(deps, linked.id, true, client) }
  }
  if (profile.email !== null && findUserByEmail(deps.db, profile.email) !== undefined) {
    return { status: 'duplicated_company', email: maskEmail(profile.email) }
  }
  const now = deps.clock.now()
  const signupToken = issueOneTimeToken(deps.db, {
    purpose: 'social_signup',
    email: profile.email ?? '',
    userId: null,
    payload: { provider, provider_uid: profile.providerUid },
    now,
    expiresAt: addSeconds(now, SOCIAL_SIGNUP_TTL_SECONDS),
  })
  return { status: 'need_to_registration', email: profile.email, signupToken }
}

/**
 * Issues the company JWT the remittance-style routes expect.
 *
 * Only members of the company, or agency staff assigned to it, receive a token.
 *
 * @throws {DomainError} `NOT_FOUND` for an unknown company or `PERMISSION_DENIED` for outsiders.
 */
export async function issueCompanyJwt(deps: ServiceDeps & { jwtSecret: string; taxTermsVersion: string }, user: AuthUser, companyId: string): Promise<string> {
  const company = findCompany(deps.db, companyId)
  if (company === undefined) throw notFound('Company')
  if (loadAccessContext(deps.db, user, company, deps.taxTermsVersion) === null) {
    throw new DomainError('PERMISSION_DENIED', 'You are not a member of this company.')
  }
  const issuedAt = epochSeconds(deps.clock.now())
  const claims: CompanyJwtClaims = {
    sub: user.id,
    company_id: company.id,
    sf_company_id: company.id,
    user_type: user.userType,
    iat: issuedAt,
    exp: issuedAt + JWT_TTL_SECONDS,
  }
  return sign(claims, deps.jwtSecret, 'HS256')
}

/**
 * Changes the signed-in user's password and revokes every session, so the client signs in again.
 *
 * @throws {DomainError} `DEMO_READ_ONLY` for demo accounts or `VALIDATION_FAILED` for weak passwords.
 */
export function changeOwnPassword(deps: ServiceDeps, user: AuthUser, password: string, confirmPassword: string): void {
  if (user.userType === USER_TYPE.demoClient) throw new DomainError('DEMO_READ_ONLY', 'Demo accounts cannot change the password.')
  assertNewPassword(password, confirmPassword)
  transaction(deps.db, () => {
    updatePasswordHash(deps.db, user.id, hashPassword(password))
    revokeUserSessions(deps.db, user.id, deps.clock.now())
  })
}

/** Mails a password reset link when the account exists; callers always answer 202 so emails cannot be enumerated. */
export async function requestPasswordReset(deps: PlatformDeps, email: string): Promise<void> {
  const user = findUserByEmail(deps.db, email)
  if (user === undefined || user.is_active !== 1 || user.user_type === USER_TYPE.demoClient) return
  const now = deps.clock.now()
  const token = issueOneTimeToken(deps.db, {
    purpose: 'password_reset',
    email: user.email,
    userId: user.id,
    now,
    expiresAt: addSeconds(now, PASSWORD_RESET_TTL_SECONDS),
  })
  await deps.messenger.sendMail({ to: user.email, template: 'password_reset', token, data: {} })
}

/**
 * Resolves a password reset token that is still usable.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown tokens or `GONE` for used or expired ones.
 */
export function requireResetToken(deps: ServiceDeps, token: string): OneTimeTokenRow {
  const row = findOneTimeToken(deps.db, token, ['password_reset'])
  if (row === undefined) throw notFound('Password reset token')
  if (row.used_at !== null || !isBefore(deps.clock.now(), row.expires_at)) throw new DomainError('GONE', 'The password reset link has expired.')
  return row
}

/** Sets a new password from a reset link and revokes the user's sessions. */
export function resetPassword(deps: ServiceDeps, token: string, password: string, confirmPassword: string): void {
  const row = requireResetToken(deps, token)
  assertNewPassword(password, confirmPassword)
  const userId = row.user_id
  if (userId === null || findUser(deps.db, userId) === undefined) throw notFound('User')
  transaction(deps.db, () => {
    if (!consumeOneTimeToken(deps.db, row.token_hash, deps.clock.now())) throw new DomainError('GONE', 'The password reset link has expired.')
    updatePasswordHash(deps.db, userId, hashPassword(password))
    revokeUserSessions(deps.db, userId, deps.clock.now())
  })
}
