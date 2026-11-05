import { decode, verify } from 'hono/jwt'
import type { AuthUser, ServiceDeps } from '../../../app.types'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { USER_TYPE } from '../../access/user-type'
import { findUserByEmail, insertUser } from '../accounts/users.repository'
import { createSession, type SessionClient } from '../auth/auth.service'
import type { IssuedSession, UserRow } from '../auth/auth.types'
import { assertNewPassword, hashPassword, verifyPassword } from '../auth/password.utils'
import { findCompanyByBusinessNumber, isMember } from '../company-profile/company-profile.repository'
import { registerCompany } from '../company-profile/company-profile.service'
import { addSeconds, isBefore, maskEmail, newId, requireBusinessNumber, sha256Hex } from '../platform.utils'

/** Partner payload states, matching the legacy `PayloadState` enum. */
export type PayloadState = 'INTEGRATED' | 'EXISTS_COMPANY' | 'NO_COMPANY'

/** Partner ID of the Overtax single sign-on. */
export const OVERTAX_PARTNER_ID = 'overtax'

interface PartnerRow {
  id: string
  name: string
  jwt_secret_enc: string
}

/**
 * Verifies a partner payload JWT; the partner is identified by its `iss` claim.
 *
 * @throws {DomainError} `UNAUTHENTICATED` for unknown partners, bad signatures or expired payloads.
 */
export async function verifyPartnerPayload(deps: ServiceDeps, token: string | undefined, expectedPartner?: string): Promise<{ partnerId: string; claims: Record<string, unknown> }> {
  if (token === undefined || token === '') throw unauthenticated()
  let issuer: unknown
  try {
    issuer = decode(token).payload['iss']
  } catch {
    throw unauthenticated()
  }
  const partnerId = expectedPartner ?? (typeof issuer === 'string' ? issuer : undefined)
  const partner = partnerId === undefined ? undefined : findPartner(deps, partnerId)
  if (partner === undefined) throw unauthenticated()
  let claims: Record<string, unknown>
  try {
    claims = await verify(token, deps.cipher.decrypt(partner.jwt_secret_enc), { alg: 'HS256', exp: false, nbf: false, iat: false })
  } catch {
    throw unauthenticated()
  }
  const expiry = claims['exp']
  if (typeof expiry === 'number' && expiry * 1000 <= Date.parse(deps.clock.now())) throw unauthenticated()
  return { partnerId: partner.id, claims }
}

/**
 * Resolves the partner of an `X-API-KEY` header.
 *
 * @throws {DomainError} `UNAUTHENTICATED` for missing or unknown keys.
 */
export function partnerFromApiKey(deps: ServiceDeps, apiKey: string | undefined): string {
  if (apiKey === undefined || apiKey === '') throw unauthenticated()
  const row = queryOne<{ id: string }>(deps.db, 'SELECT id FROM partner_clients WHERE api_key_hash = ?', [sha256Hex(apiKey)])
  if (row === undefined) throw unauthenticated()
  return row.id
}

/** Reports whether the payload's business is linked to the partner, registered but unlinked, or unknown. */
export function payloadState(deps: ServiceDeps, partnerId: string, claims: Record<string, unknown>): Record<string, unknown> {
  const businessNumber = typeof claims['business_number'] === 'string' ? claims['business_number'].replace(/-/g, '') : ''
  const company = businessNumber === '' ? undefined : findCompanyByBusinessNumber(deps.db, businessNumber)
  const linked = company !== undefined && isLinked(deps, partnerId, company.id)
  const state: PayloadState = company === undefined ? 'NO_COMPANY' : linked ? 'INTEGRATED' : 'EXISTS_COMPANY'
  return { state, business_number: businessNumber, company_name: company?.name ?? claims['company_name'] ?? null }
}

/** Lists the masked emails of the system admins of the payload's company. */
export function systemAdminEmails(deps: ServiceDeps, claims: Record<string, unknown>): Record<string, unknown>[] {
  const businessNumber = typeof claims['business_number'] === 'string' ? claims['business_number'].replace(/-/g, '') : ''
  const company = findCompanyByBusinessNumber(deps.db, businessNumber)
  if (company === undefined) return []
  return queryAll<{ email: string }>(
    deps.db,
    'SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND m.is_system_admin = 1 ORDER BY u.email',
    [company.id],
  ).map((row) => ({ email: maskEmail(row.email) }))
}

/**
 * Links an existing account's company to the partner after checking the password.
 *
 * @throws {DomainError} `INVALID_CREDENTIALS`, `NOT_FOUND` for unknown
 * businesses, or `PERMISSION_DENIED` when the user is not the company's admin.
 */
export function attachCompany(deps: ServiceDeps, partnerId: string, input: { email: string; password: string; business_number: string }): Record<string, unknown> {
  const user = findUserByEmail(deps.db, input.email)
  if (user === undefined || !verifyPassword(input.password, user.password_hash)) throw new DomainError('INVALID_CREDENTIALS', 'The email or password is incorrect.')
  const company = findCompanyByBusinessNumber(deps.db, input.business_number.replace(/-/g, ''))
  if (company === undefined) throw notFound('Company')
  const membership = queryOne<{ role: string }>(deps.db, 'SELECT role FROM memberships WHERE company_id = ? AND user_id = ?', [company.id, user.id])
  if (membership?.role !== 'admin') throw new DomainError('PERMISSION_DENIED', 'Only company admins can connect a partner.')
  link(deps, partnerId, company.id, user.id)
  return { state: 'INTEGRATED', company_id: company.id }
}

/**
 * Registers a new account and company on behalf of a partner and links them.
 *
 * @throws {DomainError} `CONFLICT` when the email or business number is taken.
 */
export function joinCompany(
  deps: ServiceDeps,
  partnerId: string,
  input: { email: string; password: string; name?: string | undefined; company_name: string; business_number: string; business_type: 'corporate' | 'individual' },
): Record<string, unknown> {
  assertNewPassword(input.password, input.password)
  if (findUserByEmail(deps.db, input.email) !== undefined) throw new DomainError('CONFLICT', 'This email is already registered; use attach instead.')
  const businessNumber = requireBusinessNumber(input.business_number)
  return transaction(deps.db, () => {
    const userId = newId('u')
    insertUser(deps.db, {
      id: userId,
      email: input.email,
      userType: USER_TYPE.client,
      passwordHash: hashPassword(input.password),
      name: input.name ?? null,
      phone: null,
      createdAt: deps.clock.now(),
    })
    const company = registerCompany(deps, {
      name: input.company_name,
      businessNumber,
      businessType: input.business_type,
      phone: null,
      representativeName: input.name ?? null,
      createdBy: userId,
    })
    link(deps, partnerId, company.id, userId)
    return { state: 'INTEGRATED', company_id: company.id, user_id: userId }
  })
}

/**
 * Signs a user in from an Overtax SSO token carrying their email.
 *
 * @throws {DomainError} `UNAUTHENTICATED` for invalid tokens or `NOT_FOUND` when no account has the email.
 */
export async function overtaxLogin(deps: ServiceDeps, token: string, client: SessionClient): Promise<{ user: UserRow; session: IssuedSession }> {
  const { claims } = await verifyPartnerPayload(deps, token, OVERTAX_PARTNER_ID)
  const email = claims['email']
  const user = typeof email === 'string' ? findUserByEmail(deps.db, email) : undefined
  if (user === undefined || user.is_active !== 1) throw notFound('User')
  return { user, session: createSession(deps, user.id, false, client) }
}

/**
 * Validates a chat channel link token.
 *
 * @throws {DomainError} `VALIDATION_FAILED` with `fail_reason` set to the legacy strings
 * `token is invalid`, `token is used` or `token is expired`.
 */
export function checkChatChannelToken(deps: ServiceDeps, token: string): Record<string, unknown> {
  const row = queryOne<{ messenger_type: string; channel_name: string; expires_at: string; used_at: string | null }>(
    deps.db,
    'SELECT messenger_type, channel_name, expires_at, used_at FROM chat_channel_tokens WHERE token_hash = ?',
    [sha256Hex(token)],
  )
  if (row === undefined) throw chatFailure('token is invalid')
  if (row.used_at !== null) throw chatFailure('token is used')
  if (!isBefore(deps.clock.now(), row.expires_at)) throw chatFailure('token is expired')
  return { messenger_type: row.messenger_type, channel_name: row.channel_name, expires_at: row.expires_at }
}

/**
 * Connects a chat channel to a company the user belongs to.
 *
 * @throws {DomainError} the same failures as {@linkcode checkChatChannelToken}, or `PERMISSION_DENIED` for non-members.
 */
export function connectChatChannel(deps: ServiceDeps, user: AuthUser, token: string, companyId: string): Record<string, unknown> {
  const channel = checkChatChannelToken(deps, token)
  if (!isMember(deps.db, companyId, user.id)) throw new DomainError('PERMISSION_DENIED', 'You are not a member of this company.')
  execute(deps.db, 'UPDATE chat_channel_tokens SET used_at = ?, used_by = ?, company_id = ? WHERE token_hash = ? AND used_at IS NULL', [
    deps.clock.now(),
    user.id,
    companyId,
    sha256Hex(token),
  ])
  return { ...channel, company_id: companyId, connected: true }
}

/** Issues a chat channel token, as the messenger bridge would; used by seeds and tests. */
export function issueChatChannelToken(deps: ServiceDeps, token: string, messengerType: 'slack' | 'kakaotalk', channelName: string, ttlSeconds: number): void {
  const now = deps.clock.now()
  execute(deps.db, 'INSERT INTO chat_channel_tokens (token_hash, messenger_type, channel_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    sha256Hex(token),
    messengerType,
    channelName,
    now,
    addSeconds(now, ttlSeconds),
  ])
}

function findPartner(deps: ServiceDeps, partnerId: string): PartnerRow | undefined {
  return queryOne<PartnerRow>(deps.db, 'SELECT id, name, jwt_secret_enc FROM partner_clients WHERE id = ?', [partnerId])
}

function isLinked(deps: ServiceDeps, partnerId: string, companyId: string): boolean {
  return (
    queryOne<{ found: number }>(deps.db, "SELECT 1 AS found FROM partner_company_links WHERE partner_id = ? AND company_id = ? AND status = 'active'", [
      partnerId,
      companyId,
    ]) !== undefined
  )
}

function link(deps: ServiceDeps, partnerId: string, companyId: string, userId: string): void {
  execute(
    deps.db,
    `INSERT INTO partner_company_links (partner_id, company_id, linked_by, linked_at, status) VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT (partner_id, company_id) DO UPDATE SET status = 'active', linked_by = excluded.linked_by, linked_at = excluded.linked_at`,
    [partnerId, companyId, userId, deps.clock.now()],
  )
}

function chatFailure(reason: string): DomainError {
  return new DomainError('VALIDATION_FAILED', reason, { fail_reason: reason })
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'The partner credentials are invalid.')
}

/** Validates the body of a partner join, reusing the signup password policy. */
export function assertPartnerJoinInput(input: { email: string }): void {
  if (!input.email.includes('@')) throw invalidField('email', 'Enter a valid email.')
}
