import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne } from '../../../db/query'
import type { CompanySealRow, NotiRecipientInput, NotiRecipientRow, TemplateOverrideRow } from './e-sign.types'

const SEAL_SELECT = `SELECT s.*, u.email AS created_by_email FROM esign_company_seals s LEFT JOIN users u ON u.id = s.created_by`

/** Lists a company's seals that have not been deleted, oldest first. */
export function listActiveSeals(db: DatabaseSync, companyId: string): CompanySealRow[] {
  return queryAll<CompanySealRow>(db, `${SEAL_SELECT} WHERE s.company_id = ? AND s.deleted_at IS NULL ORDER BY s.id`, [companyId])
}

/** Finds a seal, including soft-deleted ones. */
export function findSeal(db: DatabaseSync, companyId: string, sealId: number): CompanySealRow | undefined {
  return queryOne<CompanySealRow>(db, `${SEAL_SELECT} WHERE s.company_id = ? AND s.id = ?`, [companyId, sealId])
}

/** Counts a company's seals that have not been deleted. */
export function countActiveSeals(db: DatabaseSync, companyId: string): number {
  return queryOne<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM esign_company_seals WHERE company_id = ? AND deleted_at IS NULL', [companyId])?.n ?? 0
}

/** Inserts a seal and returns its ID. */
export function insertSeal(db: DatabaseSync, companyId: string, fileId: string, source: 'upload' | 'drawn', userId: string, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    'INSERT INTO esign_company_seals (company_id, file_id, source, created_by, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [companyId, fileId, source, userId, now],
  )
  if (row === undefined) throw new Error('Seal insert returned no row.')
  return row.id
}

/** Soft-deletes a seal so documents already sent keep their snapshot, and clears it as a template default. */
export function softDeleteSeal(db: DatabaseSync, companyId: string, sealId: number, now: string): boolean {
  const changed = execute(db, 'UPDATE esign_company_seals SET deleted_at = ? WHERE company_id = ? AND id = ? AND deleted_at IS NULL', [now, companyId, sealId])
  if (changed > 0) execute(db, 'UPDATE esign_template_overrides SET default_seal_id = NULL WHERE company_id = ? AND default_seal_id = ?', [companyId, sealId])
  return changed > 0
}

/** Lists the e-sign notification recipients in display order. */
export function listNotiRecipients(db: DatabaseSync, companyId: string): NotiRecipientRow[] {
  return queryAll<NotiRecipientRow>(
    db,
    `SELECT r.*, p.name AS position_name FROM esign_noti_recipients r
     LEFT JOIN positions p ON p.company_id = r.company_id AND p.id = r.position_id
     WHERE r.company_id = ? ORDER BY r.sort_order`,
    [companyId],
  )
}

/** Replaces the e-sign notification recipients. */
export function replaceNotiRecipients(db: DatabaseSync, companyId: string, recipients: readonly NotiRecipientInput[]): void {
  execute(db, 'DELETE FROM esign_noti_recipients WHERE company_id = ?', [companyId])
  recipients.forEach((recipient, index) => {
    execute(db, 'INSERT INTO esign_noti_recipients (company_id, sort_order, name, position_id, phone, email) VALUES (?, ?, ?, ?, ?, ?)', [
      companyId,
      index,
      recipient.name,
      recipient.position,
      recipient.phone,
      recipient.email,
    ])
  })
}

/** Lists a company's template overrides. */
export function listTemplateOverrides(db: DatabaseSync, companyId: string): TemplateOverrideRow[] {
  return queryAll<TemplateOverrideRow>(db, 'SELECT * FROM esign_template_overrides WHERE company_id = ?', [companyId])
}

/** Finds a company's override of one template. */
export function findTemplateOverride(db: DatabaseSync, companyId: string, templateId: number): TemplateOverrideRow | undefined {
  return queryOne<TemplateOverrideRow>(db, 'SELECT * FROM esign_template_overrides WHERE company_id = ? AND template_id = ?', [companyId, templateId])
}

/** Inserts or replaces a company's override of a template. */
export function saveTemplateOverride(db: DatabaseSync, row: TemplateOverrideRow): void {
  execute(
    db,
    `INSERT INTO esign_template_overrides (company_id, template_id, title, body, field_defaults, is_active, default_seal_id, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, template_id) DO UPDATE SET title = excluded.title, body = excluded.body, field_defaults = excluded.field_defaults,
       is_active = excluded.is_active, default_seal_id = excluded.default_seal_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [row.company_id, row.template_id, row.title, row.body, row.field_defaults, row.is_active, row.default_seal_id, row.updated_by, row.updated_at],
  )
}

/** Returns a user's email for audit columns, or `null` when the user is unknown. */
export function findUserEmail(db: DatabaseSync, userId: string): string | null {
  return queryOne<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', [userId])?.email ?? null
}

/** Lists the emails of a company's admin members, the fallback recipients of e-sign notifications. */
export function listCompanyAdminEmails(db: DatabaseSync, companyId: string): string[] {
  return queryAll<{ email: string }>(
    db,
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND m.role = 'admin' AND u.user_type <> 99 ORDER BY u.email`,
    [companyId],
  ).map((row) => row.email)
}
