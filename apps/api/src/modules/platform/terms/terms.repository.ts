import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import { normalizeEmail } from '../platform.utils'
import type { AgreementHistoryRow, AgreementSubject, TermRow } from './terms.types'

/** Lists the version of each term in a purpose that is in effect on `today`. */
export function listCurrentTerms(db: DatabaseSync, purposeCode: string, today: string): TermRow[] {
  return queryAll<TermRow>(
    db,
    `SELECT t.* FROM terms t
     WHERE t.purpose_code = ? AND t.effective_from <= ?
       AND NOT EXISTS (
         SELECT 1 FROM terms n WHERE n.code = t.code AND n.effective_from <= ?
           AND (n.effective_from > t.effective_from OR (n.effective_from = t.effective_from AND n.id > t.id)))
     ORDER BY t.is_required DESC, t.id`,
    [purposeCode, today, today],
  )
}

/** Finds a term version by ID. */
export function findTerm(db: DatabaseSync, termId: number): TermRow | undefined {
  return queryOne<TermRow>(db, 'SELECT * FROM terms WHERE id = ?', [termId])
}

/** Returns the latest agreement per term code for a user or guest. */
export function latestAgreements(db: DatabaseSync, subject: AgreementSubject, codes: readonly string[]): Map<string, AgreementHistoryRow> {
  const result = new Map<string, AgreementHistoryRow>()
  for (const code of codes) {
    const row =
      'userId' in subject
        ? queryOne<AgreementHistoryRow>(
            db,
            'SELECT term_code, version, is_agreed, agreed_at FROM user_term_agreements WHERE user_id = ? AND term_code = ? ORDER BY id DESC LIMIT 1',
            [subject.userId, code],
          )
        : queryOne<AgreementHistoryRow>(
            db,
            'SELECT term_code, version, is_agreed, agreed_at FROM user_term_agreements WHERE lower(email) = ? AND term_code = ? ORDER BY id DESC LIMIT 1',
            [normalizeEmail(subject.email), code],
          )
    if (row !== undefined) result.set(code, row)
  }
  return result
}

/** Appends one agreement record; history is never overwritten. */
export function insertAgreement(
  db: DatabaseSync,
  subject: AgreementSubject,
  term: TermRow,
  isAgreed: boolean,
  now: string,
  client: { ip: string | null; userAgent: string | null },
): void {
  execute(
    db,
    `INSERT INTO user_term_agreements (user_id, email, term_id, term_code, version, is_agreed, ip, user_agent, agreed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'userId' in subject ? subject.userId : null,
      'email' in subject ? normalizeEmail(subject.email) : null,
      term.id,
      term.code,
      term.version,
      isAgreed ? 1 : 0,
      client.ip,
      client.userAgent,
      now,
    ],
  )
}

/** Records the legacy consent row that the access gate checks for tax terms. */
export function insertLegacyTaxAgreement(db: DatabaseSync, userId: string, version: string, now: string): void {
  execute(db, "INSERT OR IGNORE INTO term_agreements (user_id, term_type, version, agreed_at) VALUES (?, 'tax', ?, ?)", [userId, version, now])
}

/** Removes the legacy tax consent row when the user withdraws a required tax term. */
export function deleteLegacyTaxAgreement(db: DatabaseSync, userId: string, version: string): void {
  execute(db, "DELETE FROM term_agreements WHERE user_id = ? AND term_type = 'tax' AND version = ?", [userId, version])
}

/** Stores the marketing opt-in flag on the user. */
export function setMarketingAgreed(db: DatabaseSync, userId: string, agreed: boolean): void {
  execute(db, 'UPDATE users SET marketing_agreed = ? WHERE id = ?', [agreed ? 1 : 0, userId])
}
