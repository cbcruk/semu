import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../app.types'
import { transaction } from '../../db/query'
import { DomainError, invalidField, notFound } from '../../lib/domain-error'
import { sniffMimeType } from '../../lib/file-storage/sniff-mime'
import type { TaxType } from '../tax-calendar/tax-calendar.types'
import { applyCardEffects, closeReviewCard } from './filing-cards'
import { CLIENT_EDITABLE_STATUSES, TRANSITIONS } from './filing-status'
import {
  countPendingClientItems,
  type FilingPatch,
  findDocument,
  findFile,
  findFileBySha,
  findFiling,
  findRequirement,
  hasActiveDocument,
  insertDocument,
  insertEvent,
  insertFile,
  isFileOfFiling,
  isRequirementFileLinked,
  linkRequirementFile,
  listDocuments,
  listEvents,
  listRequirementFiles,
  listRequirements,
  markDocumentViewed,
  touchFiling,
  unlinkRequirementFile,
  updateFilingStatus,
  updateRequirementResponse,
} from './filings.repository'
import { serializeFilingDetail } from './filings.serializer'
import type {
  Actor,
  DocType,
  FileRow,
  FilingRow,
  RequirementRow,
  TransitionGuard,
  TransitionInput,
  TransitionName,
  TransitionRule,
  UploadInput,
} from './filings.types'
import { isDocumentVisibleToClient } from './filings.utils'

interface PreparedUpload {
  file: FileRow
  isNew: boolean
}

/** File contents together with the metadata needed to serve them. */
export interface FileDownload {
  file: FileRow
  data: Uint8Array
}

/**
 * Applies a named transition to a filing in its own transaction.
 *
 * @param expectedVersion The version the caller last saw, from `If-Match`.
 * @throws {DomainError} `INVALID_TRANSITION` (409) when the status does not allow it,
 * `VERSION_CONFLICT` (412) when the filing changed, or `VALIDATION_FAILED` when input or a guard fails.
 */
export function transitionFiling(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  name: TransitionName,
  actor: Actor,
  expectedVersion: number,
  input: TransitionInput = {},
): FilingRow {
  return transaction(deps.db, () => {
    const filing = requireFiling(deps.db, companyId, filingId)
    return applyTransition(deps, filing, name, actor, expectedVersion, input)
  })
}

/** Loads a filing with everything its detail view shows. */
export function getFilingDetail(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  viewer: 'client' | 'agency',
): { filing: FilingRow; body: Record<string, unknown> } {
  const filing = requireFiling(deps.db, companyId, filingId)
  const body = serializeFilingDetail(
    filing,
    listRequirements(deps.db, companyId, filingId),
    listRequirementFiles(deps.db, companyId, filingId),
    listDocuments(deps.db, companyId, filingId),
    listEvents(deps.db, companyId, filingId),
    viewer,
    deps.clock.today(),
  )
  return { filing, body }
}

/**
 * Sets a client's answer to a requirement item while materials are being collected.
 *
 * Choosing `pending` on an item that still has files keeps it `provided`;
 * `not_applicable` is refused until its files are removed.
 */
export function setRequirementResponse(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  code: string,
  response: 'pending' | 'not_applicable',
  note: string | null,
  actor: Actor,
): FilingRow {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const filing = requireFiling(deps.db, companyId, filingId)
    const requirement = requireClientRequirement(deps.db, companyId, filingId, code)
    const hasFiles = listRequirementFiles(deps.db, companyId, filingId).some((file) => file.code === code)
    if (response === 'not_applicable' && hasFiles) {
      throw invalidField('response', 'Remove the attached files before marking the item as not applicable.')
    }
    assertEditable(deps.db, filing, now)
    updateRequirementResponse(deps.db, companyId, filingId, code, response === 'pending' && hasFiles ? 'provided' : response, note, actorId(actor), now)
    insertEvent(deps.db, filing, actor, 'requirement_answered', null, null, { code: requirement.code, response }, now)
    return requireFiling(deps.db, companyId, filingId)
  })
}

/**
 * Attaches an uploaded file to a requirement item.
 *
 * The blob is written before the transaction; the transaction then re-checks
 * that the filing is still editable, so a lock that lands during the write
 * wins and the blob is deleted.
 */
export async function attachRequirementFile(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  code: string,
  upload: UploadInput,
  actor: Actor,
): Promise<FilingRow> {
  const filing = requireFiling(deps.db, companyId, filingId)
  requireClientRequirement(deps.db, companyId, filingId, code)
  if (!CLIENT_EDITABLE_STATUSES.includes(filing.status)) throw invalidTransition(filing)
  const prepared = await prepareUpload(deps, companyId, upload, actorId(actor))
  return commitUpload(deps, prepared, (file) => {
    const current = requireFiling(deps.db, companyId, filingId)
    const now = deps.clock.now()
    assertEditable(deps.db, current, now)
    linkRequirementFile(deps.db, companyId, filingId, code, file.id)
    updateRequirementResponse(deps.db, companyId, filingId, code, 'provided', null, actorId(actor), now)
    insertEvent(deps.db, current, actor, 'requirement_file_added', null, null, { code, file_id: file.id }, now)
    return requireFiling(deps.db, companyId, filingId)
  })
}

/** Removes a file from a requirement item, returning the item to `pending` when it was the last one. */
export function detachRequirementFile(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  code: string,
  fileId: string,
  actor: Actor,
): FilingRow {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const filing = requireFiling(deps.db, companyId, filingId)
    requireClientRequirement(deps.db, companyId, filingId, code)
    assertEditable(deps.db, filing, now)
    const remaining = unlinkRequirementFile(deps.db, companyId, filingId, code, fileId)
    if (remaining === null) throw notFound('File')
    if (remaining === 0) updateRequirementResponse(deps.db, companyId, filingId, code, 'pending', null, actorId(actor), now)
    insertEvent(deps.db, filing, actor, 'requirement_file_removed', null, null, { code, file_id: fileId }, now)
    return requireFiling(deps.db, companyId, filingId)
  })
}

/**
 * Reads a client-uploaded file of a filing.
 *
 * @param code The requirement the client reached the file through, or `null` for agency staff.
 */
export async function readRequirementFile(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  code: string | null,
  fileId: string,
): Promise<FileDownload> {
  requireFiling(deps.db, companyId, filingId)
  const linked =
    code === null
      ? isFileOfFiling(deps.db, companyId, filingId, fileId)
      : isRequirementFileLinked(deps.db, companyId, filingId, code, fileId)
  const file = linked ? findFile(deps.db, companyId, fileId) : undefined
  if (file === undefined) throw notFound('File')
  return { file, data: await deps.storage.get(file.storage_key) }
}

/** Uploads a return or payment slip while the agency prepares or after filing. */
export async function uploadAgencyDocument(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  docType: Extract<DocType, 'return' | 'payment_slip'>,
  upload: UploadInput,
  actor: Actor,
): Promise<FilingRow> {
  const allowed = ['preparing', 'filed'] as const
  const filing = requireFiling(deps.db, companyId, filingId)
  if (!allowed.some((status) => status === filing.status)) throw invalidTransition(filing)
  const prepared = await prepareUpload(deps, companyId, upload, actorId(actor))
  return commitUpload(deps, prepared, (file) => {
    const now = deps.clock.now()
    const current = requireFiling(deps.db, companyId, filingId)
    const patch: FilingPatch = docType === 'payment_slip' && current.status === 'filed' ? { payment_slip_sent_at: now } : {}
    if (!touchFiling(deps.db, companyId, filingId, allowed, now, patch)) throw invalidTransition(current)
    insertDocument(deps.db, companyId, filingId, docType, file.id, now)
    insertEvent(deps.db, current, actor, 'document_uploaded', null, null, { doc_type: docType, file_id: file.id }, now)
    return requireFiling(deps.db, companyId, filingId)
  })
}

/**
 * Uploads the purchase/sales ledger for client confirmation.
 *
 * From `reviewing` this moves the VAT filing to `ledger_pending`; while already
 * `ledger_pending` it replaces the ledger without changing state.
 */
export async function uploadLedger(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  upload: UploadInput,
  actor: Actor,
  expectedVersion: number,
): Promise<FilingRow> {
  const filing = requireFiling(deps.db, companyId, filingId)
  if (filing.status !== 'reviewing' && filing.status !== 'ledger_pending') throw invalidTransition(filing)
  if (filing.tax_type !== 'surtax') throw invalidTransition(filing)
  const prepared = await prepareUpload(deps, companyId, upload, actorId(actor))
  return commitUpload(deps, prepared, (file) => {
    const now = deps.clock.now()
    const current = requireFiling(deps.db, companyId, filingId)
    if (current.version !== expectedVersion) throw versionConflict()
    insertDocument(deps.db, companyId, filingId, 'ledger', file.id, now)
    if (current.status === 'reviewing') return applyTransition(deps, current, 'uploadLedger', actor, expectedVersion, {})
    if (!touchFiling(deps.db, companyId, filingId, ['ledger_pending'], now, { ledger_uploaded_at: now })) throw invalidTransition(current)
    insertEvent(deps.db, current, actor, 'ledger_replaced', null, null, { file_id: file.id }, now)
    return requireFiling(deps.db, companyId, filingId)
  })
}

/** Records a preliminary VAT notice issued by the tax office, attaching the notice as the payment slip. */
export async function recordNotice(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  upload: UploadInput,
  actor: Actor,
  expectedVersion: number,
  input: TransitionInput,
): Promise<FilingRow> {
  const filing = requireFiling(deps.db, companyId, filingId)
  if (filing.status !== 'scheduled' || filing.kind !== 'notice') throw invalidTransition(filing)
  const prepared = await prepareUpload(deps, companyId, upload, actorId(actor))
  return commitUpload(deps, prepared, (file) => {
    const current = requireFiling(deps.db, companyId, filingId)
    insertDocument(deps.db, companyId, filingId, 'notice', file.id, deps.clock.now())
    return applyTransition(deps, current, 'recordNotice', actor, expectedVersion, input)
  })
}

/**
 * Reads a filing document, enforcing client visibility rules.
 *
 * A client's first read of a return or notice closes the "review filing result" card.
 */
export async function readDocument(
  deps: ServiceDeps,
  companyId: string,
  filingId: string,
  documentId: string,
  viewer: 'client' | 'agency',
): Promise<FileDownload> {
  const filing = requireFiling(deps.db, companyId, filingId)
  const document = findDocument(deps.db, companyId, filingId, documentId)
  const visible =
    document !== undefined &&
    (viewer === 'agency' || (document.replaced_at === null && isDocumentVisibleToClient(document.doc_type, filing.status)))
  if (document === undefined || !visible) throw notFound('Document')
  const file = findFile(deps.db, companyId, document.file_id)
  if (file === undefined) throw notFound('Document')
  const data = await deps.storage.get(file.storage_key)
  if (viewer === 'client') {
    const now = deps.clock.now()
    transaction(deps.db, () => {
      markDocumentViewed(deps.db, companyId, document.id, now)
      if (document.doc_type === 'return' || document.doc_type === 'notice') closeReviewCard(deps.db, filing, now)
    })
  }
  return { file, data }
}

/** Throws unless a tax type's filing exists in the company. */
export function requireFilingOfType(db: DatabaseSync, companyId: string, filingId: string, taxType: TaxType): FilingRow {
  const filing = requireFiling(db, companyId, filingId)
  if (filing.tax_type !== taxType) throw notFound('Filing')
  return filing
}

function applyTransition(
  deps: ServiceDeps,
  filing: FilingRow,
  name: TransitionName,
  actor: Actor,
  expectedVersion: number,
  input: TransitionInput,
): FilingRow {
  const rule: TransitionRule = TRANSITIONS[name]
  if (actor.type !== rule.actor) throw new DomainError('PERMISSION_DENIED', `Only ${rule.actor} users can ${name} a filing.`)
  if (!rule.from.includes(filing.status)) throw invalidTransition(filing)
  if (filing.version !== expectedVersion) throw versionConflict()
  if (rule.guard !== undefined) assertGuard(deps.db, filing, rule.guard)
  const now = deps.clock.now()
  const patch = buildPatch(deps.db, name, filing, input, now)
  if (updateFilingStatus(deps.db, filing, rule.to, patch, now) === 0) throw versionConflict()
  const updated = requireFiling(deps.db, filing.company_id, filing.id)
  insertEvent(deps.db, filing, actor, name, filing.status, rule.to, eventPayload(input), now)
  applyCardEffects(deps.db, name, updated, now)
  return updated
}

function buildPatch(db: DatabaseSync, name: TransitionName, filing: FilingRow, input: TransitionInput, now: string): FilingPatch {
  switch (name) {
    case 'request':
      return { submit_due: required(input.submitDue, 'submit_due') }
    case 'reject':
      required(input.reason, 'reason')
      return { submit_due: required(input.submitDue, 'submit_due') }
    case 'uploadLedger':
      return { ledger_uploaded_at: now, ledger_confirmed_at: null }
    case 'confirmLedger':
      return { ledger_confirmed_at: now }
    case 'disputeLedger':
      required(input.reason, 'reason')
      return { ledger_dispute_count: filing.ledger_dispute_count + 1 }
    case 'file': {
      const paymentDue = input.paymentDue ?? filing.payment_due ?? filing.due_date
      if (paymentDue === null) throw invalidField('payment_due', 'A payment due date is required.')
      return {
        payable_amount: required(input.payableAmount, 'payable_amount'),
        payment_due: paymentDue,
        payment_slip_sent_at: hasActiveDocument(db, filing.company_id, filing.id, 'payment_slip') ? now : null,
      }
    }
    case 'recordNotice': {
      const amount = required(input.payableAmount, 'payable_amount')
      if (amount < 0) throw invalidField('payable_amount', 'A notice cannot carry a refund.')
      const paymentDue = input.paymentDue ?? filing.payment_due
      if (paymentDue === null) throw invalidField('payment_due', 'A payment due date is required.')
      return { payable_amount: amount, payment_due: paymentDue, payment_slip_sent_at: now }
    }
    case 'pay':
      return { settlement: 'paid', paid_on: required(input.paidOn, 'paid_on') }
    case 'close':
      return { settlement: (filing.payable_amount ?? 0) < 0 ? 'refund' : 'no_payment' }
    case 'cancel':
      required(input.reason, 'reason')
      return {}
    case 'submit':
    case 'unsubmit':
    case 'startReview':
    case 'startPreparing':
      return {}
  }
}

function assertGuard(db: DatabaseSync, filing: FilingRow, guard: TransitionGuard): void {
  switch (guard) {
    case 'noPendingClientItems':
      if (countPendingClientItems(db, filing.company_id, filing.id) > 0) {
        throw invalidField('requirements', 'Answer every requirement item before submitting.')
      }
      return
    case 'isSurtax':
      if (filing.tax_type !== 'surtax') throw invalidTransition(filing)
      return
    case 'isNotSurtax':
      if (filing.tax_type === 'surtax') throw invalidTransition(filing)
      return
    case 'hasReturnDocument':
      if (!hasActiveDocument(db, filing.company_id, filing.id, 'return')) {
        throw invalidField('documents', 'Upload the return before marking the filing as filed.')
      }
      return
    case 'isNoticeKind':
      if (filing.kind !== 'notice') throw invalidTransition(filing)
      return
    case 'payableIsPositive':
      if ((filing.payable_amount ?? 0) <= 0) throw invalidTransition(filing)
      return
    case 'payableIsNotPositive':
      if ((filing.payable_amount ?? 0) > 0) throw invalidTransition(filing)
      return
  }
}

async function prepareUpload(deps: ServiceDeps, companyId: string, upload: UploadInput, uploadedBy: string): Promise<PreparedUpload> {
  const mimeType = sniffMimeType(upload.bytes, upload.name)
  if (mimeType === null) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Only PDF, PNG, JPEG, XLSX and CSV files are accepted.')
  const sha256 = createHash('sha256').update(upload.bytes).digest('hex')
  const existing = findFileBySha(deps.db, companyId, sha256)
  if (existing !== undefined) return { file: existing, isNew: false }
  const id = randomUUID()
  const file: FileRow = {
    id,
    company_id: companyId,
    storage_key: `${companyId}/${id}`,
    original_name: upload.name,
    mime_type: mimeType,
    size_bytes: upload.bytes.byteLength,
    sha256,
    uploaded_by: uploadedBy,
    created_at: deps.clock.now(),
  }
  await deps.storage.put(file.storage_key, upload.bytes)
  return { file, isNew: true }
}

async function commitUpload<T>(deps: ServiceDeps, prepared: PreparedUpload, fn: (file: FileRow) => T): Promise<T> {
  try {
    return transaction(deps.db, () => fn(prepared.isNew ? insertFile(deps.db, prepared.file) : prepared.file))
  } catch (error) {
    if (prepared.isNew) await deps.storage.delete(prepared.file.storage_key).catch(() => undefined)
    throw error
  }
}

function assertEditable(db: DatabaseSync, filing: FilingRow, now: string): void {
  if (!touchFiling(db, filing.company_id, filing.id, CLIENT_EDITABLE_STATUSES, now)) throw invalidTransition(filing)
}

function requireFiling(db: DatabaseSync, companyId: string, filingId: string): FilingRow {
  const filing = findFiling(db, companyId, filingId)
  if (filing === undefined) throw notFound('Filing')
  return filing
}

function requireClientRequirement(db: DatabaseSync, companyId: string, filingId: string, code: string): RequirementRow {
  const requirement = findRequirement(db, companyId, filingId, code)
  if (requirement === undefined) throw notFound('Requirement')
  if (requirement.auto_linked === 1) throw invalidField('code', 'This item is linked automatically and cannot be edited.')
  return requirement
}

function invalidTransition(filing: FilingRow): DomainError {
  return new DomainError('INVALID_TRANSITION', `The filing is ${filing.status} and does not allow this action.`)
}

function versionConflict(): DomainError {
  return new DomainError('VERSION_CONFLICT', 'The filing was changed by someone else. Reload and try again.')
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw invalidField(field, 'This field is required.')
  return value
}

function actorId(actor: Actor): string {
  if (actor.id === null) throw new DomainError('PERMISSION_DENIED', 'A user is required for this action.')
  return actor.id
}

function eventPayload(input: TransitionInput): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {}
  if (input.reason !== undefined) payload['reason'] = input.reason
  if (input.message !== undefined) payload['message'] = input.message
  if (input.submitDue !== undefined) payload['submit_due'] = input.submitDue
  if (input.payableAmount !== undefined) payload['payable_amount'] = input.payableAmount
  if (input.paymentDue !== undefined) payload['payment_due'] = input.paymentDue
  if (input.paidOn !== undefined) payload['paid_on'] = input.paidOn
  return Object.keys(payload).length === 0 ? null : payload
}
