import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type { UserType } from '../../access/access.types'
import type { UserRow } from '../auth/auth.types'
import { normalizeEmail } from '../platform.utils'
import type { MembershipSummaryRow, NewUser } from './accounts.types'

/** Finds a user by ID. */
export function findUser(db: DatabaseSync, userId: string): UserRow | undefined {
  return queryOne<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [userId])
}

/** Finds a user by email, ignoring case. */
export function findUserByEmail(db: DatabaseSync, email: string): UserRow | undefined {
  return queryOne<UserRow>(db, 'SELECT * FROM users WHERE lower(email) = ?', [normalizeEmail(email)])
}

/** Inserts a user; emails are stored lower-cased. */
export function insertUser(db: DatabaseSync, user: NewUser): void {
  execute(
    db,
    `INSERT INTO users (id, email, user_type, manager_id, password_hash, name, phone, is_active, marketing_agreed, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 1, 0, ?)`,
    [user.id, normalizeEmail(user.email), user.userType, user.passwordHash, user.name, user.phone, user.createdAt],
  )
}

/** Replaces a user's password hash. */
export function updatePasswordHash(db: DatabaseSync, userId: string, passwordHash: string): void {
  execute(db, 'UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
}

/** Records a successful login. */
export function touchLastLogin(db: DatabaseSync, userId: string, now: string): void {
  execute(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [now, userId])
}

/** Finds the user linked to a social account. */
export function findUserBySocial(db: DatabaseSync, provider: string, providerUid: string): UserRow | undefined {
  return queryOne<UserRow>(
    db,
    'SELECT u.* FROM user_social_accounts s JOIN users u ON u.id = s.user_id WHERE s.provider = ? AND s.provider_uid = ?',
    [provider, providerUid],
  )
}

/** Links a social account to a user. */
export function linkSocialAccount(db: DatabaseSync, provider: string, providerUid: string, userId: string, now: string): void {
  execute(db, 'INSERT OR IGNORE INTO user_social_accounts (provider, provider_uid, user_id, created_at) VALUES (?, ?, ?, ?)', [
    provider,
    providerUid,
    userId,
    now,
  ])
}

/** Lists the companies a user belongs to, with the flags `GET /api/user/me/` reports. */
export function listMembershipSummaries(db: DatabaseSync, userId: string): MembershipSummaryRow[] {
  return queryAll<MembershipSummaryRow>(
    db,
    `SELECT c.id, c.name, c.tax_plan, m.role, m.is_system_admin FROM memberships m
     JOIN companies c ON c.id = m.company_id WHERE m.user_id = ? ORDER BY m.joined_at, c.id`,
    [userId],
  )
}

/** Lists companies assigned to an agency user, directly or through team members for managers. */
export function listAssignedCompanySummaries(db: DatabaseSync, userId: string, userType: UserType): MembershipSummaryRow[] {
  return queryAll<MembershipSummaryRow>(
    db,
    `SELECT DISTINCT c.id, c.name, c.tax_plan, 'member' AS role, 0 AS is_system_admin FROM agency_assignments a
     JOIN companies c ON c.id = a.company_id
     WHERE a.user_id = ? OR (? = 2 AND a.user_id IN (SELECT id FROM users WHERE manager_id = ?)) ORDER BY c.id`,
    [userId, userType, userId],
  )
}
