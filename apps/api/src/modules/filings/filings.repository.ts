import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../db/query'
import type { FilingPeriod, TaxType } from '../tax-calendar/tax-calendar.types'
import type {
  Actor,
  DocType,
  DocumentRow,
  EventRow,
  FileRow,
  FilingRow,
  FilingStatus,
  RequirementResponse,
  RequirementRow,
  RequirementTemplate,
} from './filings.types'

/** Columns a transition may change besides `status`, `version` and `updated_at`. */
export type FilingPatch = Partial<
  Pick<
    FilingRow,
    | 'submit_due'
    | 'payable_amount'
    | 'payment_due'
    | 'settlement'
    | 'paid_on'
    | 'ledger_uploaded_at'
    | 'ledger_confirmed_at'
    | 'ledger_dispute_count'
    | 'payment_slip_sent_at'
  >
>

/** Finds a filing within a company. */
export function findFiling(db: DatabaseSync, companyId: string, filingId: string): FilingRow | undefined {
  return queryOne<FilingRow>(db, 'SELECT * FROM tax_filings WHERE company_id = ? AND id = ?', [companyId, filingId])
}

/** Finds a filing by ID alone, for agency routes that resolve the company afterwards. */
export function findFilingById(db: DatabaseSync, filingId: string): FilingRow | undefined {
  return queryOne<FilingRow>(db, 'SELECT * FROM tax_filings WHERE id = ?', [filingId])
}

/** Lists a company's filings of one tax type, newest period first. */
export function listFilings(
  db: DatabaseSync,
  companyId: string,
  taxType: TaxType,
  year: number | undefined,
  limit: number,
  offset: number,
): { rows: FilingRow[]; count: number } {
  const where = year === undefined ? 'company_id = ? AND tax_type = ?' : 'company_id = ? AND tax_type = ? AND year = ?'
  const params: SqlValue[] = year === undefined ? [companyId, taxType] : [companyId, taxType, year]
  const rows = queryAll<FilingRow>(
    db,
    `SELECT * FROM tax_filings WHERE ${where} ORDER BY period_start DESC, revision DESC, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM tax_filings WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Lists a company's filings of several tax types for a year, ordered by payment deadline. */
export function listFilingsForYear(db: DatabaseSync, companyId: string, taxTypes: readonly TaxType[], year: number): FilingRow[] {
  if (taxTypes.length === 0) return []
  return queryAll<FilingRow>(
    db,
    `SELECT * FROM tax_filings WHERE company_id = ? AND year = ? AND tax_type IN (${placeholders(taxTypes.length)})
     ORDER BY payment_due, tax_type`,
    [companyId, year, ...taxTypes],
  )
}

/** Lists a company's open filings for the home tracker. */
export function listOpenFilings(db: DatabaseSync, companyId: string, taxTypes: readonly TaxType[]): FilingRow[] {
  if (taxTypes.length === 0) return []
  return queryAll<FilingRow>(
    db,
    `SELECT * FROM tax_filings
     WHERE company_id = ? AND status NOT IN ('scheduled', 'settled', 'cancelled') AND tax_type IN (${placeholders(taxTypes.length)})
     ORDER BY payment_due, tax_type`,
    [companyId, ...taxTypes],
  )
}

/** Lists open filings across companies for the agency work queue. */
export function listQueueFilings(
  db: DatabaseSync,
  companyIds: readonly string[],
  status: FilingStatus | undefined,
  dueBefore: string | undefined,
  limit: number,
  offset: number,
): { rows: FilingRow[]; count: number } {
  if (companyIds.length === 0) return { rows: [], count: 0 }
  const conditions = [`company_id IN (${placeholders(companyIds.length)})`, "status NOT IN ('settled', 'cancelled')"]
  const params: SqlValue[] = [...companyIds]
  if (status !== undefined) {
    conditions.push('status = ?')
    params.push(status)
  }
  if (dueBefore !== undefined) {
    conditions.push('payment_due <= ?')
    params.push(dueBefore)
  }
  const where = conditions.join(' AND ')
  const rows = queryAll<FilingRow>(
    db,
    `SELECT * FROM tax_filings WHERE ${where} ORDER BY payment_due, ledger_dispute_count DESC, id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM tax_filings WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/**
 * Inserts a filing and its requirement checklist unless the natural key already exists.
 *
 * @returns The new filing ID, or `null` when the filing already existed.
 */
export function insertFilingIfAbsent(
  db: DatabaseSync,
  companyId: string,
  period: FilingPeriod,
  templates: readonly RequirementTemplate[],
  now: string,
): string | null {
  const id = randomUUID()
  const changes = execute(
    db,
    `INSERT INTO tax_filings (id, company_id, tax_type, kind, tax_period_key, revision, year, quarter, period_start, period_end,
       statutory_due, due_date, payment_due, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
     ON CONFLICT (company_id, tax_type, tax_period_key, revision) DO NOTHING`,
    [
      id,
      companyId,
      period.taxType,
      period.kind,
      period.taxPeriodKey,
      period.year,
      period.quarter,
      period.periodStart,
      period.periodEnd,
      period.statutoryDue,
      period.dueDate,
      period.paymentDue,
      now,
      now,
    ],
  )
  if (changes === 0) return null
  for (const template of templates) {
    execute(
      db,
      `INSERT INTO filing_requirements (company_id, filing_id, code, label, response, auto_linked)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, id, template.code, template.label, template.autoLinked ? 'provided' : 'pending', template.autoLinked ? 1 : 0],
    )
  }
  return id
}

/**
 * Updates the deadlines of a filing that is still open to scheduling changes.
 *
 * @returns Whether a row changed.
 */
export function refreshDeadlines(db: DatabaseSync, companyId: string, period: FilingPeriod, now: string): boolean {
  const changes = execute(
    db,
    `UPDATE tax_filings SET statutory_due = ?, due_date = ?, payment_due = ?, version = version + 1, updated_at = ?
     WHERE company_id = ? AND tax_type = ? AND tax_period_key = ? AND revision = 0
       AND status IN ('scheduled', 'requested')
       AND (statutory_due IS NOT ? OR due_date IS NOT ? OR payment_due IS NOT ?)`,
    [
      period.statutoryDue,
      period.dueDate,
      period.paymentDue,
      now,
      companyId,
      period.taxType,
      period.taxPeriodKey,
      period.statutoryDue,
      period.dueDate,
      period.paymentDue,
    ],
  )
  return changes > 0
}

/** Lists scheduled filings whose payment deadline falls in a window, for stale-period cancellation. */
export function listScheduledInWindow(db: DatabaseSync, companyId: string, from: string, to: string): FilingRow[] {
  return queryAll<FilingRow>(
    db,
    "SELECT * FROM tax_filings WHERE company_id = ? AND status = 'scheduled' AND revision = 0 AND payment_due BETWEEN ? AND ?",
    [companyId, from, to],
  )
}

/**
 * Applies a state transition with optimistic locking.
 *
 * @returns The number of changed rows: 0 means the status or version moved underneath.
 */
export function updateFilingStatus(
  db: DatabaseSync,
  filing: FilingRow,
  to: FilingStatus,
  patch: FilingPatch,
  now: string,
): number {
  const entries = Object.entries(patch) as [keyof FilingPatch, SqlValue][]
  const sets = entries.map(([column]) => `, ${column} = ?`).join('')
  return execute(
    db,
    `UPDATE tax_filings SET status = ?, version = version + 1, updated_at = ?${sets}
     WHERE id = ? AND company_id = ? AND status = ? AND version = ?`,
    [to, now, ...entries.map(([, value]) => value), filing.id, filing.company_id, filing.status, filing.version],
  )
}

/**
 * Bumps a filing's version while it is in one of the given statuses, for edits that do not change state.
 *
 * @returns Whether the filing was still in an allowed status.
 */
export function touchFiling(
  db: DatabaseSync,
  companyId: string,
  filingId: string,
  allowed: readonly FilingStatus[],
  now: string,
  patch: FilingPatch = {},
): boolean {
  const entries = Object.entries(patch) as [keyof FilingPatch, SqlValue][]
  const sets = entries.map(([column]) => `, ${column} = ?`).join('')
  return (
    execute(
      db,
      `UPDATE tax_filings SET version = version + 1, updated_at = ?${sets}
       WHERE company_id = ? AND id = ? AND status IN (${placeholders(allowed.length)})`,
      [now, ...entries.map(([, value]) => value), companyId, filingId, ...allowed],
    ) > 0
  )
}

/** Appends an entry to the filing audit log. */
export function insertEvent(
  db: DatabaseSync,
  filing: Pick<FilingRow, 'id' | 'company_id'>,
  actor: Actor,
  type: string,
  fromStatus: FilingStatus | null,
  toStatus: FilingStatus | null,
  payload: Record<string, unknown> | null,
  now: string,
): void {
  execute(
    db,
    `INSERT INTO filing_events (company_id, filing_id, actor_type, actor_id, type, from_status, to_status, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [filing.company_id, filing.id, actor.type, actor.id, type, fromStatus, toStatus, payload === null ? null : JSON.stringify(payload), now],
  )
}

/** Lists a filing's audit log in order. */
export function listEvents(db: DatabaseSync, companyId: string, filingId: string): EventRow[] {
  return queryAll<EventRow>(db, 'SELECT * FROM filing_events WHERE company_id = ? AND filing_id = ? ORDER BY id', [companyId, filingId])
}

/** Lists a filing's requirement items in template order. */
export function listRequirements(db: DatabaseSync, companyId: string, filingId: string): RequirementRow[] {
  return queryAll<RequirementRow>(
    db,
    'SELECT * FROM filing_requirements WHERE company_id = ? AND filing_id = ? ORDER BY rowid',
    [companyId, filingId],
  )
}

/** Finds one requirement item. */
export function findRequirement(db: DatabaseSync, companyId: string, filingId: string, code: string): RequirementRow | undefined {
  return queryOne<RequirementRow>(
    db,
    'SELECT * FROM filing_requirements WHERE company_id = ? AND filing_id = ? AND code = ?',
    [companyId, filingId, code],
  )
}

/** Sets a requirement's response. */
export function updateRequirementResponse(
  db: DatabaseSync,
  companyId: string,
  filingId: string,
  code: string,
  response: RequirementResponse,
  note: string | null,
  userId: string,
  now: string,
): void {
  execute(
    db,
    `UPDATE filing_requirements SET response = ?, note = COALESCE(?, note), updated_by = ?, updated_at = ?
     WHERE company_id = ? AND filing_id = ? AND code = ?`,
    [response, note, userId, now, companyId, filingId, code],
  )
}

/** Counts client-answerable items that are still pending. */
export function countPendingClientItems(db: DatabaseSync, companyId: string, filingId: string): number {
  return (
    queryOne<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM filing_requirements WHERE company_id = ? AND filing_id = ? AND auto_linked = 0 AND response = 'pending'",
      [companyId, filingId],
    )?.n ?? 0
  )
}

/** Finds a stored file by its content hash. */
export function findFileBySha(db: DatabaseSync, companyId: string, sha256: string): FileRow | undefined {
  return queryOne<FileRow>(db, 'SELECT * FROM files WHERE company_id = ? AND sha256 = ?', [companyId, sha256])
}

/** Finds a stored file by ID within a company. */
export function findFile(db: DatabaseSync, companyId: string, fileId: string): FileRow | undefined {
  return queryOne<FileRow>(db, 'SELECT * FROM files WHERE company_id = ? AND id = ?', [companyId, fileId])
}

/** Inserts file metadata, returning the existing row when the same content was stored concurrently. */
export function insertFile(db: DatabaseSync, file: FileRow): FileRow {
  execute(
    db,
    `INSERT INTO files (id, company_id, storage_key, original_name, mime_type, size_bytes, sha256, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (company_id, sha256) DO NOTHING`,
    [file.id, file.company_id, file.storage_key, file.original_name, file.mime_type, file.size_bytes, file.sha256, file.uploaded_by, file.created_at],
  )
  return findFileBySha(db, file.company_id, file.sha256) ?? file
}

/** Lists the files attached to a filing's requirements. */
export function listRequirementFiles(db: DatabaseSync, companyId: string, filingId: string): (FileRow & { code: string })[] {
  return queryAll<FileRow & { code: string }>(
    db,
    `SELECT f.*, rf.code FROM requirement_files rf JOIN files f ON f.company_id = rf.company_id AND f.id = rf.file_id
     WHERE rf.company_id = ? AND rf.filing_id = ? ORDER BY f.created_at, f.id`,
    [companyId, filingId],
  )
}

/** Links a file to a requirement item; linking the same file twice is a no-op. */
export function linkRequirementFile(db: DatabaseSync, companyId: string, filingId: string, code: string, fileId: string): void {
  execute(
    db,
    'INSERT INTO requirement_files (company_id, filing_id, code, file_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [companyId, filingId, code, fileId],
  )
}

/**
 * Removes a file link from a requirement item.
 *
 * @returns How many links remain on the item.
 */
export function unlinkRequirementFile(db: DatabaseSync, companyId: string, filingId: string, code: string, fileId: string): number | null {
  const changes = execute(
    db,
    'DELETE FROM requirement_files WHERE company_id = ? AND filing_id = ? AND code = ? AND file_id = ?',
    [companyId, filingId, code, fileId],
  )
  if (changes === 0) return null
  return (
    queryOne<{ n: number }>(
      db,
      'SELECT COUNT(*) AS n FROM requirement_files WHERE company_id = ? AND filing_id = ? AND code = ?',
      [companyId, filingId, code],
    )?.n ?? 0
  )
}

/** Checks whether a file is linked to a requirement item. */
export function isRequirementFileLinked(db: DatabaseSync, companyId: string, filingId: string, code: string, fileId: string): boolean {
  return (
    queryOne<{ found: number }>(
      db,
      'SELECT 1 AS found FROM requirement_files WHERE company_id = ? AND filing_id = ? AND code = ? AND file_id = ?',
      [companyId, filingId, code, fileId],
    ) !== undefined
  )
}

/** Checks whether a file belongs to any requirement item of a filing. */
export function isFileOfFiling(db: DatabaseSync, companyId: string, filingId: string, fileId: string): boolean {
  return (
    queryOne<{ found: number }>(
      db,
      'SELECT 1 AS found FROM requirement_files WHERE company_id = ? AND filing_id = ? AND file_id = ?',
      [companyId, filingId, fileId],
    ) !== undefined
  )
}

/** Lists a filing's documents, including replaced ones. */
export function listDocuments(db: DatabaseSync, companyId: string, filingId: string): (DocumentRow & { original_name: string; mime_type: string; size_bytes: number })[] {
  return queryAll(
    db,
    `SELECT d.*, f.original_name, f.mime_type, f.size_bytes FROM filing_documents d
     JOIN files f ON f.company_id = d.company_id AND f.id = d.file_id
     WHERE d.company_id = ? AND d.filing_id = ? ORDER BY d.created_at, d.id`,
    [companyId, filingId],
  )
}

/** Finds a document of a filing. */
export function findDocument(db: DatabaseSync, companyId: string, filingId: string, documentId: string): DocumentRow | undefined {
  return queryOne<DocumentRow>(
    db,
    'SELECT * FROM filing_documents WHERE company_id = ? AND filing_id = ? AND id = ?',
    [companyId, filingId, documentId],
  )
}

/** Checks whether a filing has a current, unreplaced document of a type. */
export function hasActiveDocument(db: DatabaseSync, companyId: string, filingId: string, docType: DocType): boolean {
  return (
    queryOne<{ found: number }>(
      db,
      'SELECT 1 AS found FROM filing_documents WHERE company_id = ? AND filing_id = ? AND doc_type = ? AND replaced_at IS NULL',
      [companyId, filingId, docType],
    ) !== undefined
  )
}

/** Adds a document, marking any current document of the same type as replaced. */
export function insertDocument(
  db: DatabaseSync,
  companyId: string,
  filingId: string,
  docType: DocType,
  fileId: string,
  now: string,
): string {
  execute(
    db,
    'UPDATE filing_documents SET replaced_at = ? WHERE company_id = ? AND filing_id = ? AND doc_type = ? AND replaced_at IS NULL',
    [now, companyId, filingId, docType],
  )
  const id = randomUUID()
  execute(
    db,
    'INSERT INTO filing_documents (id, company_id, filing_id, doc_type, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, companyId, filingId, docType, fileId, now],
  )
  return id
}

/** Records the first time a client opened a document. */
export function markDocumentViewed(db: DatabaseSync, companyId: string, documentId: string, now: string): void {
  execute(
    db,
    'UPDATE filing_documents SET first_viewed_at = ? WHERE company_id = ? AND id = ? AND first_viewed_at IS NULL',
    [now, companyId, documentId],
  )
}
