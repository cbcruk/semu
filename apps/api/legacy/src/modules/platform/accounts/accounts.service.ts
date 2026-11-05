import type { AuthUser, ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { isAgencyUser, USER_TYPE } from '../../access/user-type'
import type { IssuedSession, UserRow } from '../auth/auth.types'
import { createSession, type SessionClient } from '../auth/auth.service'
import { assertNewPassword, hashPassword } from '../auth/password.utils'
import { findCompanyByBusinessNumber, findCompanyProfile } from '../company-profile/company-profile.repository'
import { registerCompany } from '../company-profile/company-profile.service'
import type { CompanyProfileRow } from '../company-profile/company-profile.types'
import { activateSignedContract } from '../contracts/contracts.service'
import type { MeCompany, PlatformDeps } from '../platform.types'
import { addSeconds, isBefore, isValidBusinessNumber, newId, normalizeEmail, requireBusinessNumber } from '../platform.utils'
import { assertRequiredTermsAnswered, recordAgreements } from '../terms/terms.service'
import type { AgreementInput } from '../terms/terms.types'
import { consumeOneTimeToken, findOneTimeToken, issueOneTimeToken } from './one-time-tokens.repository'
import { findUser, findUserByEmail, insertUser, linkSocialAccount, listAssignedCompanySummaries, listMembershipSummaries } from './users.repository'

const SIGNUP_EMAIL_TTL_SECONDS = 24 * 60 * 60

/** Body of the signup endpoints that create a user. */
export interface SignupInput {
  email?: string | undefined
  password: string
  confirm_password: string
  name?: string | undefined
  phone?: string | undefined
  agreements: AgreementInput[]
}

/** Serializes the signed-in user for `GET /api/user/me/`, including company summaries. */
export function getMe(deps: ServiceDeps, user: AuthUser): Record<string, unknown> {
  const row = findUser(deps.db, user.id)
  if (row === undefined) throw notFound('User')
  const summaries = isAgencyUser(row.user_type) ? listAssignedCompanySummaries(deps.db, row.id, row.user_type) : listMembershipSummaries(deps.db, row.id)
  const companies: MeCompany[] = summaries.map((summary) => ({
    id: summary.id,
    sf_company_id: summary.id,
    name: summary.name,
    tax_plan: summary.tax_plan,
    is_system_admin: summary.is_system_admin === 1,
  }))
  return { ...serializeProfile(row), companies }
}

/** Serializes a user without companies, for `GET /api/member/profile/` and login responses. */
export function serializeProfile(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    user_type: row.user_type,
    marketing_agreed: row.marketing_agreed === 1,
    last_login_at: row.last_login_at,
  }
}

/** Checks whether an email is already registered, ignoring case. */
export function isEmailTaken(deps: ServiceDeps, email: string): boolean {
  return findUserByEmail(deps.db, email) !== undefined
}

/**
 * Mails a signup link for an email address that is not registered yet.
 *
 * @throws {DomainError} `CONFLICT` when the email is already registered.
 */
export async function sendSignupVerification(deps: PlatformDeps, email: string): Promise<void> {
  if (isEmailTaken(deps, email)) throw new DomainError('CONFLICT', 'This email is already registered.')
  const now = deps.clock.now()
  const token = issueOneTimeToken(deps.db, { purpose: 'signup_email', email, userId: null, now, expiresAt: addSeconds(now, SIGNUP_EMAIL_TTL_SECONDS) })
  await deps.messenger.sendMail({ to: normalizeEmail(email), template: 'signup_verification', token, data: {} })
}

/**
 * Creates a user from a mailed signup link or a social signup token and signs them in.
 *
 * The email comes from the token; social tokens without an email take it
 * from the body. Required signup terms must be agreed in the same request.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown tokens, `GONE` for used or
 * expired ones, `CONFLICT` for registered emails, or `VALIDATION_FAILED`.
 */
export function signupWithToken(
  deps: ServiceDeps & { taxTermsVersion: string },
  token: string,
  input: SignupInput,
  client: SessionClient,
): { user: UserRow; session: IssuedSession } {
  const row = findOneTimeToken(deps.db, token, ['signup_email', 'social_signup'])
  if (row === undefined) throw notFound('Signup token')
  if (row.used_at !== null || !isBefore(deps.clock.now(), row.expires_at)) throw new DomainError('GONE', 'The signup link has expired.')
  const email = row.email === '' ? input.email : row.email
  if (email === undefined || email === '') throw invalidField('email', 'Enter an email address.')
  assertNewPassword(input.password, input.confirm_password)
  assertRequiredTermsAnswered(deps, 'signup', input.agreements)
  if (isEmailTaken(deps, email)) throw new DomainError('CONFLICT', 'This email is already registered.')
  const userId = newId('u')
  const now = deps.clock.now()
  transaction(deps.db, () => {
    if (!consumeOneTimeToken(deps.db, row.token_hash, now)) throw new DomainError('GONE', 'The signup link has expired.')
    insertUser(deps.db, {
      id: userId,
      email,
      userType: USER_TYPE.client,
      passwordHash: hashPassword(input.password),
      name: input.name ?? null,
      phone: input.phone ?? null,
      createdAt: now,
    })
    if (row.purpose === 'social_signup' && row.payload !== null) {
      const payload = JSON.parse(row.payload) as { provider: string; provider_uid: string }
      linkSocialAccount(deps.db, payload.provider, payload.provider_uid, userId, now)
    }
  })
  recordAgreements(deps, { userId }, input.agreements, client, deps.taxTermsVersion)
  const user = findUser(deps.db, userId)
  if (user === undefined) throw notFound('User')
  return { user, session: createSession(deps, userId, false, client) }
}

/** Validates a business number and reports whether it is registered here and with the tax office. */
export async function checkBusinessNumber(deps: PlatformDeps, raw: string): Promise<Record<string, unknown>> {
  const digits = raw.replace(/-/g, '')
  const isValid = isValidBusinessNumber(digits)
  const status = await deps.businessStatus.lookup(digits)
  return {
    business_number: digits,
    is_valid: isValid,
    is_duplicated: findCompanyByBusinessNumber(deps.db, digits) !== undefined,
    business_status: status.businessStatus,
    taxation_type: status.taxationType,
    closed_on: status.closedOn,
  }
}

/**
 * Registers a company for the signed-in user, who becomes its admin and system admin.
 *
 * A direct contract already signed for the business number starts the tax
 * subscription in the same transaction.
 *
 * @throws {DomainError} `DEMO_READ_ONLY`, `VALIDATION_FAILED` for invalid or
 * closed businesses, or `CONFLICT` for registered business numbers.
 */
export async function registerCompanyForUser(
  deps: PlatformDeps,
  user: AuthUser,
  input: { name: string; business_number: string; business_type: 'corporate' | 'individual'; phone?: string | undefined; representative_name?: string | undefined },
): Promise<CompanyProfileRow> {
  if (user.userType === USER_TYPE.demoClient) throw new DomainError('DEMO_READ_ONLY', 'Demo accounts cannot change data.')
  const businessNumber = requireBusinessNumber(input.business_number)
  const status = await deps.businessStatus.lookup(businessNumber)
  if (status.businessStatus === 'closed') throw invalidField('business_number', 'This business is closed.')
  return transaction(deps.db, () => {
    const company = registerCompany(deps, {
      name: input.name,
      businessNumber,
      businessType: input.business_type,
      phone: input.phone ?? null,
      representativeName: input.representative_name ?? null,
      createdBy: user.id,
    })
    activateSignedContract(deps, company)
    return findCompanyProfile(deps.db, company.id) ?? company
  })
}
