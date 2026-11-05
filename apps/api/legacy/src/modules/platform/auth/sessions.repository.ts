import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../../db/query'
import type { SessionRow } from './auth.types'

/** Stores a new session keyed by the hash of its cookie value. */
export function insertSession(db: DatabaseSync, session: SessionRow): void {
  execute(
    db,
    `INSERT INTO sessions (id, user_id, csrf_token, stay_signed_in, user_agent, ip, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [session.id, session.user_id, session.csrf_token, session.stay_signed_in, session.user_agent, session.ip, session.created_at, session.expires_at],
  )
}

/** Finds a session that is neither revoked nor expired at `now`. */
export function findActiveSession(db: DatabaseSync, sessionId: string, now: string): SessionRow | undefined {
  const row = queryOne<SessionRow>(db, 'SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL', [sessionId])
  if (row === undefined || Date.parse(row.expires_at) <= Date.parse(now)) return undefined
  return row
}

/** Revokes one session. */
export function revokeSession(db: DatabaseSync, sessionId: string, now: string): void {
  execute(db, 'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now, sessionId])
}

/** Revokes every active session of a user, used after password changes. */
export function revokeUserSessions(db: DatabaseSync, userId: string, now: string): number {
  return execute(db, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId])
}
