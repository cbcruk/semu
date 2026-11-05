import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../../db/query'
import { normalizeEmail, randomToken, sha256Hex } from '../platform.utils'
import type { OneTimeTokenPurpose, OneTimeTokenRow } from './accounts.types'

/**
 * Issues a single-use token and stores only its hash.
 *
 * @returns The plaintext token to embed in the mailed link.
 */
export function issueOneTimeToken(
  db: DatabaseSync,
  input: { purpose: OneTimeTokenPurpose; email: string; userId: string | null; payload?: unknown; now: string; expiresAt: string },
): string {
  const token = randomToken()
  execute(
    db,
    'INSERT INTO one_time_tokens (token_hash, purpose, email, user_id, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      sha256Hex(token),
      input.purpose,
      normalizeEmail(input.email),
      input.userId,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.now,
      input.expiresAt,
    ],
  )
  return token
}

/** Finds a token of one of the given purposes by its plaintext value, used or not. */
export function findOneTimeToken(db: DatabaseSync, token: string, purposes: readonly OneTimeTokenPurpose[]): OneTimeTokenRow | undefined {
  const row = queryOne<OneTimeTokenRow>(db, 'SELECT * FROM one_time_tokens WHERE token_hash = ?', [sha256Hex(token)])
  return row !== undefined && purposes.includes(row.purpose) ? row : undefined
}

/** Marks a token used; returns `false` when it was already used. */
export function consumeOneTimeToken(db: DatabaseSync, tokenHash: string, now: string): boolean {
  return execute(db, 'UPDATE one_time_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', [now, tokenHash]) === 1
}
