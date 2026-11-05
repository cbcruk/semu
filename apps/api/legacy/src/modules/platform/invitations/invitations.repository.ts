import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import { normalizeEmail } from '../platform.utils'
import type { InvitationRow } from './invitations.types'

/** Marks pending invitations whose validity has passed as expired, so a new one can be sent. */
export function expireStaleInvitations(db: DatabaseSync, now: string): void {
  for (const row of queryAll<{ id: string; expires_at: string }>(db, "SELECT id, expires_at FROM internal_invitations WHERE status = 'pending'")) {
    if (Date.parse(row.expires_at) <= Date.parse(now)) execute(db, "UPDATE internal_invitations SET status = 'expired' WHERE id = ?", [row.id])
  }
}

/** Inserts an invitation. */
export function insertInvitation(db: DatabaseSync, row: InvitationRow): void {
  execute(
    db,
    `INSERT INTO internal_invitations (id, company_id, email, token_hash, is_admin, role_ids, status, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.company_id, row.email, row.token_hash, row.is_admin, row.role_ids, row.status, row.invited_by, row.created_at, row.expires_at],
  )
}

/** Finds the pending invitation for an email in a company. */
export function findPendingInvitation(db: DatabaseSync, companyId: string, email: string): InvitationRow | undefined {
  return queryOne<InvitationRow>(db, "SELECT * FROM internal_invitations WHERE company_id = ? AND lower(email) = ? AND status = 'pending'", [
    companyId,
    normalizeEmail(email),
  ])
}

/** Finds an invitation within a company. */
export function findInvitation(db: DatabaseSync, companyId: string, invitationId: string): InvitationRow | undefined {
  return queryOne<InvitationRow>(db, 'SELECT * FROM internal_invitations WHERE company_id = ? AND id = ?', [companyId, invitationId])
}

/** Finds an invitation by the hash of its token. */
export function findInvitationByTokenHash(db: DatabaseSync, tokenHash: string): InvitationRow | undefined {
  return queryOne<InvitationRow>(db, 'SELECT * FROM internal_invitations WHERE token_hash = ?', [tokenHash])
}

/** Lists a company's invitations that have not been accepted or cancelled, newest first. */
export function listOpenInvitations(db: DatabaseSync, companyId: string): InvitationRow[] {
  return queryAll<InvitationRow>(
    db,
    "SELECT * FROM internal_invitations WHERE company_id = ? AND status IN ('pending','expired') ORDER BY created_at DESC, id",
    [companyId],
  )
}

/** Lists every invitation of a company, newest first. */
export function listInvitations(db: DatabaseSync, companyId: string): InvitationRow[] {
  return queryAll<InvitationRow>(db, 'SELECT * FROM internal_invitations WHERE company_id = ? ORDER BY created_at DESC, id', [companyId])
}

/** Lists pending invitations addressed to an email across companies. */
export function listPendingInvitationsForEmail(db: DatabaseSync, email: string): (InvitationRow & { company_name: string })[] {
  return queryAll<InvitationRow & { company_name: string }>(
    db,
    `SELECT i.*, c.name AS company_name FROM internal_invitations i JOIN companies c ON c.id = i.company_id
     WHERE lower(i.email) = ? AND i.status = 'pending' ORDER BY i.created_at DESC`,
    [normalizeEmail(email)],
  )
}

/** Moves an invitation from `pending` to another state; returns `false` when it was no longer pending. */
export function closeInvitation(
  db: DatabaseSync,
  invitationId: string,
  status: 'accepted' | 'cancelled',
  values: { now: string; acceptedUserId?: string },
): boolean {
  const changed =
    status === 'accepted'
      ? execute(db, "UPDATE internal_invitations SET status = 'accepted', accepted_at = ?, accepted_user_id = ? WHERE id = ? AND status = 'pending'", [
          values.now,
          values.acceptedUserId ?? null,
          invitationId,
        ])
      : execute(db, "UPDATE internal_invitations SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'pending'", [values.now, invitationId])
  return changed === 1
}
