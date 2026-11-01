import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { ContractRow, SignupInvitationRow } from './contracts.types'

/** Finds a direct contract by ID. */
export function findContract(db: DatabaseSync, contractId: string): ContractRow | undefined {
  return queryOne<ContractRow>(db, 'SELECT * FROM bookkeeping_contracts WHERE id = ?', [contractId])
}

/** Finds the newest signed or active online contract of a company. */
export function findCompanyContract(db: DatabaseSync, companyId: string): ContractRow | undefined {
  return queryOne<ContractRow>(
    db,
    "SELECT * FROM bookkeeping_contracts WHERE company_id = ? AND status IN ('signed','active') ORDER BY signed_at DESC LIMIT 1",
    [companyId],
  )
}

/** Lists signed contracts waiting for their company to be registered. */
export function findSignedContractForBusiness(db: DatabaseSync, businessNumber: string): ContractRow | undefined {
  return queryOne<ContractRow>(
    db,
    "SELECT * FROM bookkeeping_contracts WHERE business_number = ? AND company_id IS NULL AND status = 'signed' ORDER BY signed_at DESC LIMIT 1",
    [businessNumber],
  )
}

/** Inserts a draft contract. */
export function insertContract(db: DatabaseSync, row: ContractRow): void {
  execute(
    db,
    `INSERT INTO bookkeeping_contracts (id, company_id, business_number, representative_phone, fee_inputs, monthly_fee, adjustment_fee, status, kind,
       auto_renew, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.company_id,
      row.business_number,
      row.representative_phone,
      row.fee_inputs,
      row.monthly_fee,
      row.adjustment_fee,
      row.status,
      row.kind,
      row.auto_renew,
      row.created_at,
      row.expires_at,
    ],
  )
}

/** Updates contract columns. */
export function updateContract(db: DatabaseSync, contractId: string, values: Partial<Omit<ContractRow, 'id'>>): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return
  execute(db, `UPDATE bookkeeping_contracts SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`, [
    ...entries.map(([, value]) => (value ?? null) as SqlValue),
    contractId,
  ])
}

/** Stores an SMS verification code hash. */
export function insertSmsVerification(
  db: DatabaseSync,
  row: { id: string; purpose: string; targetId: string; phone: string; codeHash: string; now: string; expiresAt: string },
): void {
  execute(db, 'INSERT INTO sms_verifications (id, purpose, target_id, phone, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    row.id,
    row.purpose,
    row.targetId,
    row.phone,
    row.codeHash,
    row.now,
    row.expiresAt,
  ])
}

/** Finds the newest SMS verification for a target. */
export function findLatestSmsVerification(
  db: DatabaseSync,
  purpose: string,
  targetId: string,
): { id: string; phone: string; code_hash: string; attempts: number; expires_at: string; verified_at: string | null } | undefined {
  return queryOne(db, 'SELECT id, phone, code_hash, attempts, expires_at, verified_at FROM sms_verifications WHERE purpose = ? AND target_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [
    purpose,
    targetId,
  ])
}

/** Counts a failed attempt or marks the verification as passed. */
export function recordSmsAttempt(db: DatabaseSync, id: string, verifiedAt: string | null): void {
  execute(db, 'UPDATE sms_verifications SET attempts = attempts + 1, verified_at = COALESCE(?, verified_at) WHERE id = ?', [verifiedAt, id])
}

/** Finds a signup invitation by the hash of its token. */
export function findSignupInvitationByHash(db: DatabaseSync, tokenHash: string): SignupInvitationRow | undefined {
  return queryOne<SignupInvitationRow>(db, 'SELECT * FROM signup_invitations WHERE token_hash = ?', [tokenHash])
}

/** Finds a signup invitation by ID. */
export function findSignupInvitation(db: DatabaseSync, invitationId: string): SignupInvitationRow | undefined {
  return queryOne<SignupInvitationRow>(db, 'SELECT * FROM signup_invitations WHERE id = ?', [invitationId])
}

/** Updates a signup invitation. */
export function updateSignupInvitation(db: DatabaseSync, invitationId: string, values: Partial<Omit<SignupInvitationRow, 'id' | 'token_hash'>>): void {
  const entries = Object.entries(values)
  if (entries.length === 0) return
  execute(db, `UPDATE signup_invitations SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`, [
    ...entries.map(([, value]) => (value ?? null) as SqlValue),
    invitationId,
  ])
}

/** Creates a signup session after the invited email is confirmed. */
export function insertSignupSession(db: DatabaseSync, row: { id: string; invitationId: string; email: string; now: string }): void {
  execute(db, 'INSERT INTO signup_sessions (id, invitation_id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)', [
    row.id,
    row.invitationId,
    row.email,
    row.now,
    row.now,
  ])
}

/** Finds a signup session. */
export function findSignupSession(db: DatabaseSync, sessionId: string): { id: string; invitation_id: string; email: string; agreed_at: string | null } | undefined {
  return queryOne(db, 'SELECT id, invitation_id, email, agreed_at FROM signup_sessions WHERE id = ?', [sessionId])
}

/** Stores the agreements given in a signup session. */
export function recordSignupAgreements(db: DatabaseSync, sessionId: string, agreements: string, now: string): void {
  execute(db, 'UPDATE signup_sessions SET agreements = ?, agreed_at = ? WHERE id = ?', [agreements, now, sessionId])
}

/** Lists open signup invitations addressed to an email. */
export function listOpenSignupInvitations(db: DatabaseSync, email: string): SignupInvitationRow[] {
  return queryAll<SignupInvitationRow>(
    db,
    "SELECT * FROM signup_invitations WHERE lower(email) = ? AND status IN ('issued','email_verified','agreed') ORDER BY created_at DESC",
    [email.toLowerCase()],
  )
}
