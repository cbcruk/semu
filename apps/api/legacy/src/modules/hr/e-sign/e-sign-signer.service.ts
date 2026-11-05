import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../../../db/query'
import { invalidField } from '../../../lib/domain-error'
import { toSeoulIso } from '../../../lib/clock'
import { findCompany } from '../../companies/companies.repository'
import { findEmployeeRow } from '../employees/employees.repository'
import { isValidLeavingReason, LEAVING_REASONS } from '../retirement/leaving-reasons'
import type { LeavingReason } from '../retirement/retirement.types'
import { HrError } from '../shared/hr-error'
import { commitHrFile, DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, prepareHrFile, readHrFile, type HrFileDownload, type HrUpload } from '../shared/hr-files'
import { invalidState } from '../shared/hr.utils'
import { applyCompletionEffects } from './e-sign-completion'
import { notifyStaff, sendLogged } from './e-sign-notify'
import {
  findLiveSignerSession,
  findRequestByTokenHash,
  insertRequestEvent,
  insertSignerSeal,
  insertSignerSession,
  listRequestEvents,
  listSignerSeals,
  loadAggregate,
  recordVerifyFailure,
  transitionRequest,
} from './e-sign-requests.repository'
import { expireOverdueESignRequests, messageVars } from './e-sign-requests.service'
import { findTemplate } from './e-sign-settings.service'
import type { CompleteInput, ESignRequestAggregate, ESignRequestRow, FieldValueMap, RequestOrigin } from './e-sign.types'
import { CLOSED_STATUSES, createSecret, hashSecret, maskName, MAX_VERIFY_FAILURES, SIGNER_SESSION_MINUTES } from './e-sign.utils'
import type { HrContext } from '../shared/hr-context.types'

/**
 * Resolves a signing token to its request after expiring overdue requests of that company.
 *
 * @throws {HrError} `SIGNING_TOKEN_INVALID` when no request carries the token.
 */
export async function resolveSigningToken(context: HrContext, token: string): Promise<ESignRequestAggregate> {
  const { db } = context.deps
  const found = findRequestByTokenHash(db, hashSecret(token))
  if (found === undefined) throw new HrError('SIGNING_TOKEN_INVALID', 'This signing link is not valid.')
  await expireOverdueESignRequests(context, found.company_id)
  const current = findRequestByTokenHash(db, hashSecret(token))
  if (current === undefined) throw new HrError('SIGNING_TOKEN_INVALID', 'This signing link is not valid.')
  return loadAggregate(db, current)
}

/** Builds the entry summary the worker sees before verifying, for any request status. */
export function signerSummary(db: DatabaseSync, aggregate: ESignRequestAggregate): Record<string, unknown> {
  const { request, recipient, documents } = aggregate
  return {
    status: request.status,
    company_name: findCompany(db, request.company_id)?.name ?? null,
    recipient_name: maskName(recipient.name),
    documents: documents.map((document) => ({ index: document.doc_index, title: document.title, document_kind: document.document_kind })),
    due_date: request.due_date,
    expired: request.status === 'expired',
    requires_birth_date: expectedBirthDate(db, aggregate) !== null,
  }
}

/**
 * Checks the worker's identity and opens a signer session; the first success moves `pending → in_progress`.
 *
 * @throws {HrError} `SIGNING_CLOSED` for closed requests, `IDENTITY_VERIFICATION_LOCKED` after five failures, `IDENTITY_VERIFICATION_FAILED` on mismatch.
 */
export async function verifySigner(
  context: HrContext,
  aggregate: ESignRequestAggregate,
  claim: { name: string; birth_date?: string | undefined },
  origin: RequestOrigin,
): Promise<{ session_token: string; expires_at: string }> {
  const { db, clock } = context.deps
  const { request } = aggregate
  assertOpen(request)
  if (request.status === 'completed') throw new HrError('SIGNING_CLOSED', 'This document has already been signed.', { status: request.status })
  if (request.verify_failures >= MAX_VERIFY_FAILURES) throw locked()
  const ok = await context.adapters.identityVerifier.verify({ name: aggregate.recipient.name, birthDate: expectedBirthDate(db, aggregate) }, claim)
  if (!ok) {
    const failures = transaction(db, () => {
      insertRequestEvent(db, request, 'verify_failed', { type: 'signer', id: null }, origin, null, clock.now())
      return recordVerifyFailure(db, request.id)
    })
    throw new HrError('IDENTITY_VERIFICATION_FAILED', 'The name or birth date does not match.', { remaining_attempts: Math.max(0, MAX_VERIFY_FAILURES - failures) })
  }
  const session = createSecret()
  const now = clock.now()
  const expiresAt = toSeoulIso(new Date(Date.parse(now) + SIGNER_SESSION_MINUTES * 60_000))
  transaction(db, () => {
    insertSignerSession(db, request, hashSecret(session), origin, now, expiresAt)
    if (request.status === 'pending') {
      transitionRequest(db, request.company_id, request.id, ['pending'], 'in_progress', null, { verified_at: now, verify_failures: 0 }, now)
    }
    insertRequestEvent(db, request, 'verified', { type: 'signer', id: null }, origin, null, now)
  })
  return { session_token: session, expires_at: expiresAt }
}

/**
 * Checks the `X-ESign-Session` header against the request's live sessions.
 *
 * @param allowCompleted Whether a completed request is acceptable, as for downloads.
 * @throws {HrError} `SIGNING_CLOSED`, `SIGNER_SESSION_REQUIRED` or `SIGNER_SESSION_INVALID`.
 */
export function requireSignerSession(context: HrContext, aggregate: ESignRequestAggregate, sessionHeader: string | undefined, allowCompleted: boolean): void {
  const { request } = aggregate
  assertOpen(request)
  if (request.status === 'completed' && !allowCompleted) throw new HrError('SIGNING_CLOSED', 'This document has already been signed.', { status: request.status })
  if (sessionHeader === undefined || sessionHeader.trim() === '') throw new HrError('SIGNER_SESSION_REQUIRED', 'Verify your identity first.')
  if (findLiveSignerSession(context.deps.db, request.id, hashSecret(sessionHeader.trim()), context.deps.clock.now()) === undefined) {
    throw new HrError('SIGNER_SESSION_INVALID', 'Your session has expired. Verify your identity again.')
  }
}

/** Lists the documents to sign with their fields and the administrator's values. */
export function signerDocuments(db: DatabaseSync, aggregate: ESignRequestAggregate): Record<string, unknown>[] {
  const values = JSON.parse(aggregate.request.field_values) as FieldValueMap
  return aggregate.documents.map((document) => {
    const template = findTemplate(db, aggregate.request.company_id, document.template_id)
    const fields = template?.fields ?? []
    return {
      index: document.doc_index,
      title: document.title,
      document_kind: document.document_kind,
      category: document.category,
      body: template?.body ?? [],
      fields,
      field_values: values[String(document.doc_index)] ?? {},
      signer_fields: fields.filter((field) => field.signer).map((field) => field.key),
      has_company_seal: aggregate.request.company_seal_file_id !== null,
    }
  })
}

/** Lists the signature images the worker uploaded. */
export function signerSeals(db: DatabaseSync, aggregate: ESignRequestAggregate): { id: number; created: string }[] {
  return listSignerSeals(db, aggregate.request.id).map((seal) => ({ id: seal.id, created: seal.created_at }))
}

/** Stores a signature image drawn or uploaded by the worker; the file is attributed to the requesting administrator. */
export async function addSignerSeal(context: HrContext, aggregate: ESignRequestAggregate, upload: HrUpload, origin: RequestOrigin): Promise<{ id: number; created: string }> {
  const { request } = aggregate
  const prepared = await prepareHrFile(context.deps, request.company_id, upload, request.created_by, IMAGE_MIME_TYPES)
  return commitHrFile(context.deps, prepared, (file) => {
    const now = context.deps.clock.now()
    const id = insertSignerSeal(context.deps.db, request, file.id, now)
    insertRequestEvent(context.deps.db, request, 'signer_seal_added', { type: 'signer', id: null }, origin, { seal_id: id }, now)
    return { id, created: now }
  })
}

/** Reads one of the worker's signature images. */
export async function readSignerSeal(context: HrContext, aggregate: ESignRequestAggregate, sealId: number): Promise<HrFileDownload> {
  const seal = listSignerSeals(context.deps.db, aggregate.request.id).find((candidate) => candidate.id === sealId)
  if (seal === undefined) throw invalidField('seal_id', 'Unknown signature.')
  return readHrFile(context.deps, aggregate.request.company_id, seal.file_id)
}

/** Leaving reasons offered on a resignation letter. */
export function signerLeavingReasons(): readonly LeavingReason[] {
  return LEAVING_REASONS
}

/**
 * Completes the signature: renders the signed PDF, stores it, then marks the request completed and applies rule R29.
 *
 * The PDF is rendered and written before the transaction, which re-checks
 * that the request is still in progress; on failure the new blob is deleted.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when a document is missing, a seal is unknown or a resignation reason is invalid.
 */
export async function completeSigning(context: HrContext, aggregate: ESignRequestAggregate, input: CompleteInput, origin: RequestOrigin): Promise<Record<string, unknown>> {
  const { db, clock } = context.deps
  const { request, recipient, documents } = aggregate
  const seals = listSignerSeals(db, request.id)
  documents.forEach((document) => {
    const submitted = input.documents.find((candidate) => candidate.index === document.doc_index)
    if (submitted === undefined) throw invalidField('documents', `Sign document ${document.doc_index + 1}.`)
    if (!seals.some((seal) => seal.id === submitted.seal_id)) throw invalidField(`documents.${document.doc_index}.seal_id`, 'Upload a signature first.')
  })
  if (documents.some((document) => document.document_kind === 'resignation')) {
    if (input.leaving_reason === undefined || !isValidLeavingReason(input.leaving_reason, input.leaving_detail_reason ?? null)) {
      throw invalidField('leaving_reason', 'Choose a leaving reason.')
    }
  }
  const images = await Promise.all(
    [
      ...(request.company_seal_file_id === null ? [] : [request.company_seal_file_id]),
      ...input.documents.flatMap((document) => seals.filter((seal) => seal.id === document.seal_id).map((seal) => seal.file_id)),
    ].map(async (fileId) => (await readHrFile(context.deps, request.company_id, fileId)).data),
  )
  const now = clock.now()
  const adminValues = JSON.parse(request.field_values) as FieldValueMap
  const audit = [
    ...listRequestEvents(db, request.id).map((event) => `${event.created_at} ${event.type} (${event.actor_type}) ip=${event.ip ?? '-'} ua=${event.user_agent ?? '-'}`),
    `${now} completed (signer) ip=${origin.ip ?? '-'} ua=${origin.userAgent ?? '-'}`,
  ]
  const pdf = await context.adapters.pdfRenderer.render({
    title: documents[0]?.title ?? '전자서명 문서',
    sections: documents.map((document) => {
      const values = { ...(adminValues[String(document.doc_index)] ?? {}), ...input.documents.find((candidate) => candidate.index === document.doc_index)?.field_values }
      return { heading: document.title, lines: Object.entries(values).filter(([key]) => key !== '__hidden').map(([key, value]) => `${key}: ${String(value)}`) }
    }),
    images,
    auditTrail: [...audit, `signer: ${recipient.name}`, `document sha256: ${createHash('sha256').update(request.field_values).digest('hex')}`],
  })
  const fileName = `${documents[0]?.title ?? 'e-sign'}_${recipient.name}.pdf`
  const prepared = await prepareHrFile(context.deps, request.company_id, { name: fileName, bytes: pdf }, request.created_by, DOCUMENT_MIME_TYPES)
  const effects = await commitHrFile(context.deps, prepared, (file) => {
    const signerInput = JSON.stringify({ documents: input.documents, leaving_reason: input.leaving_reason ?? null, leaving_detail_reason: input.leaving_detail_reason ?? null, agreed_at: input.agreed_at ?? null })
    if (!transitionRequest(db, request.company_id, request.id, ['in_progress'], 'completed', request.version, { result_file_id: file.id, signed_at: now, signer_input: signerInput }, now)) {
      throw invalidState('e-sign request', loadAggregate(db, request).request.status)
    }
    insertRequestEvent(db, request, 'completed', { type: 'signer', id: null }, origin, null, now)
    return applyCompletionEffects(db, aggregate, input, { fileId: file.id, fileName }, clock.today(), now)
  })
  const vars = messageVars(db, aggregate)
  await notifyStaff(context, request.company_id, request.id, 'e_sign_completed', vars)
  if (recipient.email !== null) {
    await sendLogged(context, request.company_id, { type: 'e_sign_request', id: request.id }, {
      channel: 'email',
      to: recipient.email,
      template: 'e_sign_completed_copy',
      vars,
      attachments: [{ name: fileName, mimeType: 'application/pdf', data: pdf }],
    })
  }
  return { status: 'completed', signed_at: now, employee_id: effects.employeeId }
}

/** Reads the signed PDF for the worker. */
export async function readSignedPdf(context: HrContext, aggregate: ESignRequestAggregate): Promise<HrFileDownload> {
  const { request } = aggregate
  if (request.status !== 'completed' || request.result_file_id === null) throw invalidState('e-sign request', request.status)
  return readHrFile(context.deps, request.company_id, request.result_file_id)
}

function expectedBirthDate(db: DatabaseSync, aggregate: ESignRequestAggregate): string | null {
  const { recipient } = aggregate
  if (recipient.birth_date !== null) return recipient.birth_date
  if (recipient.employee_id === null) return null
  return findEmployeeRow(db, recipient.company_id, recipient.employee_id)?.birth_date ?? null
}

function assertOpen(request: ESignRequestRow): void {
  if (CLOSED_STATUSES.includes(request.status)) throw new HrError('SIGNING_CLOSED', `This request is ${request.status}.`, { status: request.status })
}

function locked(): HrError {
  return new HrError('IDENTITY_VERIFICATION_LOCKED', 'Too many failed attempts. Ask the sender to resend the request.')
}
