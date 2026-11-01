import type { AuthUser, ServiceDeps } from '../../../app.types'
import { execute, transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { USER_TYPE } from '../../access/user-type'
import { findUser, findUserByEmail, insertUser } from '../accounts/users.repository'
import { createSession, type SessionClient } from '../auth/auth.service'
import type { IssuedSession } from '../auth/auth.types'
import { assertNewPassword, hashPassword } from '../auth/password.utils'
import { findCompanyProfile, insertMembership, isMember } from '../company-profile/company-profile.repository'
import { countRoles } from '../company-users/company-users.repository'
import type { PlatformDeps } from '../platform.types'
import { addSeconds, isBefore, newId, normalizeEmail, parseStringArray, randomToken, sha256Hex } from '../platform.utils'
import { assertRequiredTermsAnswered, recordAgreements } from '../terms/terms.service'
import {
  closeInvitation,
  expireStaleInvitations,
  findInvitation,
  findInvitationByTokenHash,
  findPendingInvitation,
  insertInvitation,
  listInvitations,
} from './invitations.repository'
import type { AcceptInput, InvitationInput, InvitationRow, InvitationStatus } from './invitations.types'

/** Days an internal invitation stays valid. */
export const INVITATION_TTL_DAYS = 30

/**
 * Invites an email to the company with an admin flag and permission roles, then mails the link.
 *
 * Expired invitations are closed first, so re-inviting after expiry creates a
 * fresh pending invitation with a new token. A second pending invitation for
 * the same email is refused; the admin cancels and re-invites instead.
 *
 * @throws {DomainError} `CONFLICT` for members and duplicate pending invitations,
 * or `VALIDATION_FAILED` for unknown roles.
 */
export async function createInvitation(deps: PlatformDeps, companyId: string, inviter: AuthUser, input: InvitationInput): Promise<InvitationRow> {
  const email = normalizeEmail(input.email)
  const now = deps.clock.now()
  const token = randomToken()
  const row = transaction(deps.db, () => {
    expireStaleInvitations(deps.db, now)
    const existing = findUserByEmail(deps.db, email)
    if (existing !== undefined && isMember(deps.db, companyId, existing.id)) throw new DomainError('CONFLICT', 'This user is already a member.')
    if (findPendingInvitation(deps.db, companyId, email) !== undefined) {
      throw new DomainError('CONFLICT', 'An invitation is already pending; cancel it before inviting again.')
    }
    const roleIds = input.is_admin ? [] : [...new Set(input.role_ids)]
    if (countRoles(deps.db, companyId, roleIds) !== roleIds.length) throw invalidField('role_ids', 'Unknown permission role.')
    const invitation: InvitationRow = {
      id: newId('inv'),
      company_id: companyId,
      email,
      token_hash: sha256Hex(token),
      is_admin: input.is_admin ? 1 : 0,
      role_ids: JSON.stringify(roleIds),
      status: 'pending',
      invited_by: inviter.id,
      created_at: now,
      expires_at: addSeconds(now, INVITATION_TTL_DAYS * 86_400),
      accepted_at: null,
      accepted_user_id: null,
      cancelled_at: null,
    }
    insertInvitation(deps.db, invitation)
    return invitation
  })
  const company = findCompanyProfile(deps.db, companyId)
  await deps.messenger.sendMail({ to: email, template: 'internal_invitation', token, data: { company_name: company?.name ?? '' } })
  return row
}

/** Lists a company's invitations with their display status. */
export function listCompanyInvitations(deps: ServiceDeps, companyId: string): InvitationRow[] {
  return listInvitations(deps.db, companyId)
}

/**
 * Cancels a pending invitation so its link stops working.
 *
 * @throws {DomainError} `NOT_FOUND` or `INVALID_TRANSITION` when it is no longer pending.
 */
export function cancelInvitation(deps: ServiceDeps, companyId: string, invitationId: string): void {
  const invitation = findInvitation(deps.db, companyId, invitationId)
  if (invitation === undefined) throw notFound('Invitation')
  if (effectiveStatus(invitation, deps.clock.now()) !== 'pending') throw new DomainError('INVALID_TRANSITION', 'Only pending invitations can be cancelled.')
  closeInvitation(deps.db, invitationId, 'cancelled', { now: deps.clock.now() })
}

/** Returns the status an invitation has at `now`, deriving `expired` from its validity. */
export function effectiveStatus(invitation: InvitationRow, now: string): InvitationStatus {
  if (invitation.status === 'pending' && !isBefore(now, invitation.expires_at)) return 'expired'
  return invitation.status
}

/**
 * Describes an invitation for the public join page.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown tokens.
 */
export function describeInvitation(deps: ServiceDeps, token: string): Record<string, unknown> {
  const invitation = findInvitationByTokenHash(deps.db, sha256Hex(token))
  if (invitation === undefined) throw notFound('Invitation')
  const company = findCompanyProfile(deps.db, invitation.company_id)
  const inviter = findUser(deps.db, invitation.invited_by)
  return {
    company_id: invitation.company_id,
    company_name: company?.name ?? null,
    email: invitation.email,
    inviter_name: inviter?.name ?? inviter?.email ?? null,
    is_admin: invitation.is_admin === 1,
    is_existing_user: findUserByEmail(deps.db, invitation.email) !== undefined,
    status: effectiveStatus(invitation, deps.clock.now()),
    expires_at: invitation.expires_at,
  }
}

/**
 * Accepts an invitation, creating the account when the email is new, and adds the membership with the invited roles.
 *
 * Existing users must be signed in as the invited email. New users send a
 * password and the required signup terms and are signed in afterwards.
 *
 * @throws {DomainError} `NOT_FOUND`, `GONE` for cancelled, accepted or expired
 * invitations, `UNAUTHENTICATED` when an existing user is not signed in, or
 * `PERMISSION_DENIED` when signed in as someone else.
 */
export function acceptInvitation(
  deps: ServiceDeps & { taxTermsVersion: string },
  token: string,
  input: AcceptInput,
  signedIn: AuthUser | null,
  client: SessionClient,
): { userId: string; companyId: string; session: IssuedSession | null } {
  const invitation = findInvitationByTokenHash(deps.db, sha256Hex(token))
  if (invitation === undefined) throw notFound('Invitation')
  const now = deps.clock.now()
  if (effectiveStatus(invitation, now) !== 'pending') throw new DomainError('GONE', 'This invitation is no longer valid.')
  const existing = findUserByEmail(deps.db, invitation.email)
  if (existing !== undefined) {
    if (signedIn === null) throw new DomainError('UNAUTHENTICATED', 'Sign in with the invited email to accept.')
    if (signedIn.id !== existing.id) throw new DomainError('PERMISSION_DENIED', 'This invitation was sent to another email.')
  } else {
    assertNewPassword(input.password ?? '', input.confirm_password ?? '')
    assertRequiredTermsAnswered(deps, 'signup', input.agreements ?? [])
  }
  const userId = existing?.id ?? newId('u')
  transaction(deps.db, () => {
    if (existing === undefined) {
      insertUser(deps.db, {
        id: userId,
        email: invitation.email,
        userType: USER_TYPE.client,
        passwordHash: hashPassword(input.password ?? ''),
        name: input.name ?? null,
        phone: null,
        createdAt: now,
      })
    }
    if (!closeInvitation(deps.db, invitation.id, 'accepted', { now, acceptedUserId: userId })) throw new DomainError('GONE', 'This invitation is no longer valid.')
    if (isMember(deps.db, invitation.company_id, userId)) throw new DomainError('CONFLICT', 'You are already a member of this company.')
    insertMembership(deps.db, {
      companyId: invitation.company_id,
      userId,
      role: invitation.is_admin === 1 ? 'admin' : 'member',
      isSystemAdmin: false,
      invitedBy: invitation.invited_by,
      now,
    })
    for (const roleId of parseStringArray(invitation.role_ids)) {
      execute(
        deps.db,
        'INSERT OR IGNORE INTO membership_roles (company_id, user_id, role_id) SELECT ?, ?, id FROM perm_roles WHERE company_id = ? AND id = ?',
        [invitation.company_id, userId, invitation.company_id, roleId],
      )
    }
  })
  if (existing === undefined) recordAgreements(deps, { userId }, input.agreements ?? [], client, deps.taxTermsVersion)
  return { userId, companyId: invitation.company_id, session: existing === undefined ? createSession(deps, userId, false, client) : null }
}

/** Serializes an invitation for the admin screens. */
export function serializeInvitation(row: InvitationRow, now: string, roleNames: ReadonlyMap<string, string>): Record<string, unknown> {
  const status = effectiveStatus(row, now)
  const remainingDays = status === 'pending' ? Math.ceil((Date.parse(row.expires_at) - Date.parse(now)) / 86_400_000) : null
  return {
    id: row.id,
    email: row.email,
    is_admin: row.is_admin === 1,
    roles: parseStringArray(row.role_ids).map((id) => ({ id, name: roleNames.get(id) ?? null })),
    status,
    invited_at: row.created_at,
    expires_at: row.expires_at,
    remaining_days: remainingDays,
  }
}
