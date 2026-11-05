import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type {
  ESignDocumentRow,
  ESignDraftValues,
  ESignListFilter,
  ESignRecipientRow,
  ESignRequestAggregate,
  ESignRequestRow,
  ESignRequestStatus,
  RequestOrigin,
} from './e-sign.types'

/** Columns a status transition may set besides `status`, `version` and `updated_at`. */
export type ESignRequestPatch = Partial<
  Pick<
    ESignRequestRow,
    | 'due_date'
    | 'token_hash'
    | 'verify_failures'
    | 'send_error'
    | 'sent_at'
    | 'verified_at'
    | 'signed_at'
    | 'expired_at'
    | 'cancelled_at'
    | 'voided_at'
    | 'result_file_id'
    | 'signer_input'
    | 'company_seal_file_id'
    | 'updated_by'
  >
>

/** Finds a request within a company. */
export function findRequest(db: DatabaseSync, companyId: string, requestId: number): ESignRequestRow | undefined {
  return queryOne<ESignRequestRow>(db, 'SELECT * FROM esign_requests WHERE company_id = ? AND id = ?', [companyId, requestId])
}

/** Finds a request by the hash of its signing token. */
export function findRequestByTokenHash(db: DatabaseSync, tokenHash: string): ESignRequestRow | undefined {
  return queryOne<ESignRequestRow>(db, 'SELECT * FROM esign_requests WHERE token_hash = ?', [tokenHash])
}

/** Loads a request with its documents and recipient. */
export function loadAggregate(db: DatabaseSync, request: ESignRequestRow): ESignRequestAggregate {
  const documents = queryAll<ESignDocumentRow>(db, 'SELECT * FROM esign_request_documents WHERE company_id = ? AND request_id = ? ORDER BY doc_index', [
    request.company_id,
    request.id,
  ])
  const recipient = queryOne<ESignRecipientRow>(db, 'SELECT * FROM esign_recipients WHERE company_id = ? AND request_id = ?', [request.company_id, request.id])
  if (recipient === undefined) throw new Error(`Request ${request.id} has no recipient.`)
  return { request, documents, recipient }
}

/** Inserts a draft request and returns its ID. */
export function insertDraft(db: DatabaseSync, companyId: string, values: ESignDraftValues, userId: string, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO esign_requests (company_id, workplace_size, wage_type, work_condition_id, work_schedule_policy_id, field_values, company_seal_id,
       due_date, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      companyId,
      values.workplace_size,
      values.wage_type,
      values.work_condition_id,
      values.work_schedule_policy_id,
      values.field_values,
      values.company_seal_id,
      values.due_date,
      userId,
      userId,
      now,
      now,
    ],
  )
  if (row === undefined) throw new Error('Request insert returned no row.')
  return row.id
}

/** Updates a draft's editable columns without changing its version. */
export function updateDraft(db: DatabaseSync, companyId: string, requestId: number, values: ESignDraftValues, userId: string, now: string): boolean {
  return (
    execute(
      db,
      `UPDATE esign_requests SET workplace_size = ?, wage_type = ?, work_condition_id = ?, work_schedule_policy_id = ?, field_values = ?,
         company_seal_id = ?, due_date = ?, updated_by = ?, updated_at = ?
       WHERE company_id = ? AND id = ? AND status = 'draft'`,
      [
        values.workplace_size,
        values.wage_type,
        values.work_condition_id,
        values.work_schedule_policy_id,
        values.field_values,
        values.company_seal_id,
        values.due_date,
        userId,
        now,
        companyId,
        requestId,
      ],
    ) > 0
  )
}

/** Replaces a request's documents. */
export function replaceDocuments(db: DatabaseSync, companyId: string, requestId: number, documents: readonly Omit<ESignDocumentRow, 'company_id' | 'request_id'>[]): void {
  execute(db, 'DELETE FROM esign_request_documents WHERE company_id = ? AND request_id = ?', [companyId, requestId])
  for (const document of documents) {
    execute(
      db,
      `INSERT INTO esign_request_documents (company_id, request_id, doc_index, template_id, template_type, title, document_kind, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, requestId, document.doc_index, document.template_id, document.template_type, document.title, document.document_kind, document.category],
    )
  }
}

/** Inserts or replaces a request's recipient. */
export function saveRecipient(db: DatabaseSync, recipient: ESignRecipientRow): void {
  execute(
    db,
    `INSERT INTO esign_recipients (company_id, request_id, employment_type, employee_id, name, email, phone, is_local, nationality, visa, birth_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (request_id) DO UPDATE SET employment_type = excluded.employment_type, employee_id = excluded.employee_id, name = excluded.name,
       email = excluded.email, phone = excluded.phone, is_local = excluded.is_local, nationality = excluded.nationality, visa = excluded.visa,
       birth_date = excluded.birth_date`,
    [
      recipient.company_id,
      recipient.request_id,
      recipient.employment_type,
      recipient.employee_id,
      recipient.name,
      recipient.email,
      recipient.phone,
      recipient.is_local,
      recipient.nationality,
      recipient.visa,
      recipient.birth_date,
    ],
  )
}

/** Links a recipient to the employee created or found when the request completed. */
export function linkRecipientEmployee(db: DatabaseSync, companyId: string, requestId: number, employeeId: number): void {
  execute(db, "UPDATE esign_recipients SET employee_id = ?, employment_type = COALESCE(employment_type, 'wageemployee') WHERE company_id = ? AND request_id = ?", [
    employeeId,
    companyId,
    requestId,
  ])
}

/**
 * Moves a request to a new status when it is still in one of `from` and at `expectedVersion`.
 *
 * @param expectedVersion The version the caller saw, or `null` for system transitions that only check the status.
 * @returns Whether the row changed.
 */
export function transitionRequest(
  db: DatabaseSync,
  companyId: string,
  requestId: number,
  from: readonly ESignRequestStatus[],
  to: ESignRequestStatus,
  expectedVersion: number | null,
  patch: ESignRequestPatch,
  now: string,
): boolean {
  const entries = Object.entries(patch)
  const assignments = ['status = ?', 'version = version + 1', 'updated_at = ?', ...entries.map(([column]) => `${column} = ?`)]
  const params: SqlValue[] = [to, now, ...entries.map(([, value]) => value as SqlValue), companyId, requestId, ...from]
  const versionClause = expectedVersion === null ? '' : ' AND version = ?'
  if (expectedVersion !== null) params.push(expectedVersion)
  return (
    execute(db, `UPDATE esign_requests SET ${assignments.join(', ')} WHERE company_id = ? AND id = ? AND status IN (${placeholders(from.length)})${versionClause}`, params) > 0
  )
}

/** Counts a failed identity check and returns the new failure count. */
export function recordVerifyFailure(db: DatabaseSync, requestId: number): number {
  execute(db, 'UPDATE esign_requests SET verify_failures = verify_failures + 1 WHERE id = ?', [requestId])
  return queryOne<{ verify_failures: number }>(db, 'SELECT verify_failures FROM esign_requests WHERE id = ?', [requestId])?.verify_failures ?? 0
}

/** Deletes a request; documents, recipient, sessions, seals and events cascade. */
export function deleteRequest(db: DatabaseSync, companyId: string, requestId: number, from: readonly ESignRequestStatus[]): boolean {
  return execute(db, `DELETE FROM esign_requests WHERE company_id = ? AND id = ? AND status IN (${placeholders(from.length)})`, [companyId, requestId, ...from]) > 0
}

/** Lists a page of a company's requests matching the filters, newest first. */
export function listRequests(db: DatabaseSync, companyId: string, filter: ESignListFilter, limit: number, offset: number): { rows: ESignRequestRow[]; count: number } {
  const clauses = ['r.company_id = ?']
  const params: SqlValue[] = [companyId]
  const dateColumn = filter.dateType === 'signed_at' ? 'r.signed_at' : 'COALESCE(r.sent_at, r.created_at)'
  if (filter.startDate !== null) {
    clauses.push(`substr(${dateColumn}, 1, 10) >= ?`)
    params.push(filter.startDate)
  }
  if (filter.endDate !== null) {
    clauses.push(`substr(${dateColumn}, 1, 10) <= ?`)
    params.push(filter.endDate)
  }
  if (filter.statuses.length > 0) {
    clauses.push(`r.status IN (${placeholders(filter.statuses.length)})`)
    params.push(...filter.statuses)
  }
  if (filter.category !== null) {
    clauses.push('EXISTS (SELECT 1 FROM esign_request_documents d WHERE d.request_id = r.id AND d.category = ?)')
    params.push(filter.category)
  }
  if (filter.employeeName !== null) {
    clauses.push("rc.name LIKE ? ESCAPE '\\'")
    params.push(like(filter.employeeName))
  }
  if (filter.search !== null) {
    clauses.push(
      `(EXISTS (SELECT 1 FROM esign_request_documents d WHERE d.request_id = r.id AND d.title LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM employees e JOIN departments dep ON dep.company_id = e.company_id AND dep.id = e.department_id
                   WHERE e.company_id = r.company_id AND e.id = rc.employee_id AND dep.name LIKE ? ESCAPE '\\'))`,
    )
    params.push(like(filter.search), like(filter.search))
  }
  const from = `FROM esign_requests r JOIN esign_recipients rc ON rc.request_id = r.id WHERE ${clauses.join(' AND ')}`
  const rows = queryAll<ESignRequestRow>(db, `SELECT r.* ${from} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
  const count = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n ${from}`, params)?.n ?? 0
  return { rows, count }
}

/** Lists requests past their due date that are still waiting for a signature. */
export function listOverdueRequests(db: DatabaseSync, companyId: string | null, today: string): ESignRequestRow[] {
  return companyId === null
    ? queryAll<ESignRequestRow>(db, "SELECT * FROM esign_requests WHERE status IN ('pending','in_progress') AND due_date < ?", [today])
    : queryAll<ESignRequestRow>(db, "SELECT * FROM esign_requests WHERE company_id = ? AND status IN ('pending','in_progress') AND due_date < ?", [companyId, today])
}

/** Appends an audit event to a request. */
export function insertRequestEvent(
  db: DatabaseSync,
  request: Pick<ESignRequestRow, 'company_id' | 'id'>,
  type: string,
  actor: { type: 'user' | 'signer' | 'system'; id: string | null },
  origin: RequestOrigin,
  payload: object | null,
  now: string,
): void {
  execute(
    db,
    `INSERT INTO esign_events (company_id, request_id, type, actor_type, actor_id, ip, user_agent, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [request.company_id, request.id, type, actor.type, actor.id, origin.ip, origin.userAgent, payload === null ? null : JSON.stringify(payload), now],
  )
}

/** Lists a request's audit events in order. */
export function listRequestEvents(db: DatabaseSync, requestId: number): { type: string; actor_type: string; ip: string | null; user_agent: string | null; created_at: string }[] {
  return queryAll(db, 'SELECT type, actor_type, ip, user_agent, created_at FROM esign_events WHERE request_id = ? ORDER BY id', [requestId])
}

/** Inserts a verified signer session. */
export function insertSignerSession(db: DatabaseSync, request: ESignRequestRow, sessionHash: string, origin: RequestOrigin, now: string, expiresAt: string): void {
  execute(
    db,
    'INSERT INTO esign_signer_sessions (company_id, request_id, session_hash, verified_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [request.company_id, request.id, sessionHash, now, expiresAt, origin.ip, origin.userAgent],
  )
}

/** Finds a session of a request that has not expired. */
export function findLiveSignerSession(db: DatabaseSync, requestId: number, sessionHash: string, now: string): { id: number } | undefined {
  return queryOne<{ id: number }>(db, 'SELECT id FROM esign_signer_sessions WHERE request_id = ? AND session_hash = ? AND expires_at > ?', [requestId, sessionHash, now])
}

/** Deletes every signer session of a request. */
export function deleteSignerSessions(db: DatabaseSync, requestId: number): void {
  execute(db, 'DELETE FROM esign_signer_sessions WHERE request_id = ?', [requestId])
}

/** Lists the signature images a signer uploaded for a request. */
export function listSignerSeals(db: DatabaseSync, requestId: number): { id: number; file_id: string; created_at: string }[] {
  return queryAll(db, 'SELECT id, file_id, created_at FROM esign_signer_seals WHERE request_id = ? ORDER BY id', [requestId])
}

/** Inserts a signer's signature image and returns its ID. */
export function insertSignerSeal(db: DatabaseSync, request: ESignRequestRow, fileId: string, now: string): number {
  const row = queryOne<{ id: number }>(db, 'INSERT INTO esign_signer_seals (company_id, request_id, file_id, created_at) VALUES (?, ?, ?, ?) RETURNING id', [
    request.company_id,
    request.id,
    fileId,
    now,
  ])
  if (row === undefined) throw new Error('Signer seal insert returned no row.')
  return row.id
}

/** Records one notification attempt; message bodies and links are not stored. */
export function logNotification(
  db: DatabaseSync,
  values: {
    companyId: string
    channel: 'email' | 'alimtalk'
    template: string
    recipient: string
    ok: boolean
    error: string | null
    sourceType: 'e_sign_request' | 'certificate'
    sourceId: number
    now: string
  },
): void {
  execute(
    db,
    `INSERT INTO hr_notifications (company_id, channel, template, recipient, status, error, source_type, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [values.companyId, values.channel, values.template, values.recipient, values.ok ? 'sent' : 'failed', values.error, values.sourceType, values.sourceId, values.now],
  )
}

/** Returns the department name of an employee, for list rows. */
export function findEmployeeDepartmentName(db: DatabaseSync, companyId: string, employeeId: number | null): string | null {
  if (employeeId === null) return null
  return (
    queryOne<{ name: string }>(
      db,
      'SELECT d.name FROM employees e JOIN departments d ON d.company_id = e.company_id AND d.id = e.department_id WHERE e.company_id = ? AND e.id = ?',
      [companyId, employeeId],
    )?.name ?? null
  )
}

function like(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
