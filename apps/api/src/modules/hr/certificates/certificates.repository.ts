import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { CertificateFilter, CertificateInsert, CertificateRow, CertificateStatus } from './certificates.types'

/** Columns a certificate transition may set besides `status`, `version` and `updated_at`. */
export type CertificatePatch = Partial<Pick<CertificateRow, 'sent_to_email' | 'sent_to_phone' | 'sent_at' | 'send_error' | 'token_hash' | 'token_expires_at' | 'verify_failures'>>

/** Finds a certificate within a company. */
export function findCertificate(db: DatabaseSync, companyId: string, certificateId: number): CertificateRow | undefined {
  return queryOne<CertificateRow>(db, 'SELECT * FROM certificate_issuances WHERE company_id = ? AND id = ?', [companyId, certificateId])
}

/** Finds a certificate by the hash of its download token. */
export function findCertificateByTokenHash(db: DatabaseSync, tokenHash: string): CertificateRow | undefined {
  return queryOne<CertificateRow>(db, 'SELECT * FROM certificate_issuances WHERE token_hash = ?', [tokenHash])
}

/** Returns the next issue number of a year, such as `2026-0003`. */
export function nextIssueNumber(db: DatabaseSync, companyId: string, year: number): string {
  const row = queryOne<{ n: number }>(db, 'SELECT COALESCE(MAX(CAST(substr(issue_number, 6) AS INTEGER)), 0) AS n FROM certificate_issuances WHERE company_id = ? AND issue_number LIKE ?', [companyId, `${year}-%`])
  return `${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`
}

/** Inserts an issued certificate and returns its ID. */
export function insertCertificate(db: DatabaseSync, values: CertificateInsert): number {
  const entries = Object.entries(values)
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO certificate_issuances (${entries.map(([key]) => key).join(', ')}, updated_at) VALUES (${placeholders(entries.length)}, ?) RETURNING id`,
    [...entries.map(([, value]) => value as SqlValue), values.created_at],
  )
  if (row === undefined) throw new Error('Certificate insert returned no row.')
  return row.id
}

/**
 * Moves a certificate to a new status when it is in one of `from` and at `expectedVersion`.
 *
 * @param expectedVersion The version the caller saw, or `null` for the second half of a send.
 */
export function transitionCertificate(
  db: DatabaseSync,
  companyId: string,
  certificateId: number,
  from: readonly CertificateStatus[],
  to: CertificateStatus,
  expectedVersion: number | null,
  patch: CertificatePatch,
  now: string,
): boolean {
  const entries = Object.entries(patch)
  const params: SqlValue[] = [to, now, ...entries.map(([, value]) => value as SqlValue), companyId, certificateId, ...from]
  if (expectedVersion !== null) params.push(expectedVersion)
  return (
    execute(
      db,
      `UPDATE certificate_issuances SET ${['status = ?', 'version = version + 1', 'updated_at = ?', ...entries.map(([key]) => `${key} = ?`)].join(', ')}
       WHERE company_id = ? AND id = ? AND status IN (${placeholders(from.length)})${expectedVersion === null ? '' : ' AND version = ?'}`,
      params,
    ) > 0
  )
}

/** Deletes a certificate and its sessions, which invalidates its link. */
export function deleteCertificate(db: DatabaseSync, companyId: string, certificateId: number): boolean {
  return execute(db, 'DELETE FROM certificate_issuances WHERE company_id = ? AND id = ?', [companyId, certificateId]) > 0
}

/** Lists a page of certificates matching the filters, newest first. */
export function listCertificates(db: DatabaseSync, companyId: string, filter: CertificateFilter, limit: number, offset: number): { rows: CertificateRow[]; count: number } {
  const { where, params } = buildWhere(companyId, filter)
  const rows = queryAll<CertificateRow>(db, `SELECT * FROM certificate_issuances WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
  const count = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM certificate_issuances WHERE ${where}`, params)?.n ?? 0
  return { rows, count }
}

/** Counts certificates per status, ignoring the status filter. */
export function countCertificatesByStatus(db: DatabaseSync, companyId: string, filter: CertificateFilter): Record<CertificateStatus | 'all', number> {
  const { where, params } = buildWhere(companyId, { ...filter, statuses: [] })
  const counts = { all: 0, issued: 0, sending: 0, sent: 0, send_failed: 0 }
  for (const row of queryAll<{ status: CertificateStatus; n: number }>(db, `SELECT status, COUNT(*) AS n FROM certificate_issuances WHERE ${where} GROUP BY status`, params)) {
    counts[row.status] = row.n
    counts.all += row.n
  }
  return counts
}

/** Counts a failed identity check and returns the new failure count. */
export function recordCertificateVerifyFailure(db: DatabaseSync, certificateId: number): number {
  execute(db, 'UPDATE certificate_issuances SET verify_failures = verify_failures + 1 WHERE id = ?', [certificateId])
  return queryOne<{ n: number }>(db, 'SELECT verify_failures AS n FROM certificate_issuances WHERE id = ?', [certificateId])?.n ?? 0
}

/** Inserts a verified recipient session. */
export function insertCertificateSession(
  db: DatabaseSync,
  certificate: CertificateRow,
  sessionHash: string,
  origin: { ip: string | null; userAgent: string | null },
  now: string,
  expiresAt: string,
): void {
  execute(
    db,
    'INSERT INTO certificate_sessions (company_id, certificate_id, session_hash, verified_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [certificate.company_id, certificate.id, sessionHash, now, expiresAt, origin.ip, origin.userAgent],
  )
}

/** Checks whether a recipient session of a certificate is live. */
export function hasLiveCertificateSession(db: DatabaseSync, certificateId: number, sessionHash: string, now: string): boolean {
  return (
    queryOne(db, 'SELECT 1 AS found FROM certificate_sessions WHERE certificate_id = ? AND session_hash = ? AND expires_at > ?', [certificateId, sessionHash, now]) !==
    undefined
  )
}

/** Deletes every recipient session of a certificate. */
export function deleteCertificateSessions(db: DatabaseSync, certificateId: number): void {
  execute(db, 'DELETE FROM certificate_sessions WHERE certificate_id = ?', [certificateId])
}

function buildWhere(companyId: string, filter: CertificateFilter): { where: string; params: SqlValue[] } {
  const clauses = ['company_id = ?']
  const params: SqlValue[] = [companyId]
  if (filter.statuses.length > 0) {
    clauses.push(`status IN (${placeholders(filter.statuses.length)})`)
    params.push(...filter.statuses)
  }
  if (filter.search !== null) {
    clauses.push("(employee_name LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')")
    const like = `%${filter.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    params.push(like, like)
  }
  if (filter.employeeId !== null) {
    clauses.push('employee_id = ?')
    params.push(filter.employeeId)
  }
  return { where: clauses.join(' AND '), params }
}
