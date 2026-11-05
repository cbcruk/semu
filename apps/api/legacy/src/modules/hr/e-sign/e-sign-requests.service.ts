import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { addDays } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findCompany } from '../../companies/companies.repository'
import { findEmployeeRow } from '../employees/employees.repository'
import type { EmployeeRow } from '../employees/employees.types'
import type { HrContext } from '../shared/hr-context.types'
import { readHrFile, type HrFileDownload } from '../shared/hr-files'
import type { EmploymentType } from '../shared/hr.types'
import { fromEmploymentType, invalidState, staleVersion, toEmploymentType, toFlag } from '../shared/hr.utils'
import { findTemplate, requireActiveSeal } from './e-sign-settings.service'
import { notifyStaff, sendLogged } from './e-sign-notify'
import {
  deleteRequest,
  deleteSignerSessions,
  findRequest,
  insertDraft,
  insertRequestEvent,
  listOverdueRequests,
  listRequests,
  loadAggregate,
  replaceDocuments,
  saveRecipient,
  transitionRequest,
  updateDraft,
  type ESignRequestPatch,
} from './e-sign-requests.repository'
import type { ESignListFilter, ESignRecipientRow, ESignRequestAggregate, ESignRequestRow, ESignRequestStatus, FieldValueMap, ResolvedTemplate } from './e-sign.types'
import { createSecret, ESIGN_DUE_DAYS, hashSecret, SIGNING_URL_BASE } from './e-sign.utils'

/** A recipient as sent by the issue screen. */
export interface RecipientInput {
  employment_type?: EmploymentType | null | undefined
  employee_id?: number | null | undefined
  name?: string | undefined
  email: string | null
  phone: string | null
  is_local: boolean
  nationality: string | null
  visa: string | null
  birth_date: PlainDate | null
}

/** A request as sent by the issue screen. */
export interface DraftInput {
  templates?: { template_type?: string | undefined; template_id: number }[] | undefined
  workplace_size?: 'gte5' | 'lt5' | null | undefined
  recipient?: RecipientInput | undefined
  wage_type?: 'monthly' | 'daily' | 'hourly' | null | undefined
  work_condition?: number | null | undefined
  work_schedule_policy?: number | null | undefined
  field_values?: FieldValueMap | undefined
  company_seal?: number | null | undefined
  due_date: PlainDate | null
  send?: boolean | undefined
}

const DELETABLE: readonly ESignRequestStatus[] = ['draft', 'expired', 'cancelled', 'send_failed']

/**
 * Expires requests whose due date has passed and tells the notification recipients (rule R24).
 *
 * Runs lazily before e-sign reads and can also run as a nightly job with `companyId` set to `null`.
 *
 * @returns The number of requests expired.
 */
export async function expireOverdueESignRequests(context: HrContext, companyId: string | null = null): Promise<number> {
  const { db, clock } = context.deps
  const overdue = listOverdueRequests(db, companyId, clock.today())
  const expired: ESignRequestRow[] = []
  transaction(db, () => {
    for (const request of overdue) {
      const expiredAt = `${addDays(request.due_date as PlainDate, 1)}T00:00:00+09:00`
      if (!transitionRequest(db, request.company_id, request.id, ['pending', 'in_progress'], 'expired', null, { expired_at: expiredAt }, clock.now())) continue
      deleteSignerSessions(db, request.id)
      insertRequestEvent(db, request, 'expired', { type: 'system', id: null }, { ip: null, userAgent: null }, null, clock.now())
      expired.push(request)
    }
  })
  for (const request of expired) {
    const aggregate = loadAggregate(db, request)
    await notifyStaff(context, request.company_id, request.id, 'e_sign_expired', messageVars(db, aggregate))
  }
  return expired.length
}

/** Lists a page of requests after expiring overdue ones. */
export async function listESignRequests(
  context: HrContext,
  companyId: string,
  filter: ESignListFilter,
  limit: number,
  offset: number,
): Promise<{ rows: ESignRequestAggregate[]; count: number }> {
  await expireOverdueESignRequests(context, companyId)
  const { rows, count } = listRequests(context.deps.db, companyId, filter, limit, offset)
  return { rows: rows.map((row) => loadAggregate(context.deps.db, row)), count }
}

/** Loads one request after expiring overdue ones. */
export async function getESignRequest(context: HrContext, companyId: string, requestId: number): Promise<ESignRequestAggregate> {
  await expireOverdueESignRequests(context, companyId)
  return requireAggregate(context.deps.db, companyId, requestId)
}

/**
 * Creates a draft request and, when `send` is set, sends it right away.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown templates or employees, or when sending is requested but the draft is incomplete.
 */
export async function createESignRequest(context: HrContext, companyId: string, input: DraftInput, userId: string): Promise<ESignRequestAggregate> {
  const { db, clock } = context.deps
  if (input.templates === undefined || input.recipient === undefined) throw invalidField('templates', 'Choose at least one template.')
  const templates = input.templates
  const recipientInput = input.recipient
  const id = transaction(db, () => {
    const requestId = insertDraft(db, companyId, draftValues(input, null), userId, clock.now())
    replaceDocuments(db, companyId, requestId, resolveDocuments(db, companyId, templates))
    saveRecipient(db, buildRecipient(db, companyId, requestId, recipientInput, null))
    insertRequestEvent(db, { company_id: companyId, id: requestId }, 'created', { type: 'user', id: userId }, { ip: null, userAgent: null }, null, clock.now())
    return requestId
  })
  if (input.send === true) return sendESignRequest(context, companyId, id, userId, null, input.due_date)
  return requireAggregate(db, companyId, id)
}

/**
 * Edits a draft (last write wins) and sends it when `send` is set.
 *
 * @param expectedVersion The `If-Match` version, required when `send` is set.
 * @throws {DomainError} `INVALID_TRANSITION` unless the request is a draft (rule R25).
 */
export async function patchESignRequest(
  context: HrContext,
  companyId: string,
  requestId: number,
  input: DraftInput,
  userId: string,
  expectedVersion: number | null,
): Promise<ESignRequestAggregate> {
  const { db, clock } = context.deps
  transaction(db, () => {
    const aggregate = requireAggregate(db, companyId, requestId)
    if (aggregate.request.status !== 'draft') throw invalidState('e-sign request', aggregate.request.status)
    if (expectedVersion !== null && aggregate.request.version !== expectedVersion) throw staleVersion('e-sign request')
    updateDraft(db, companyId, requestId, draftValues(input, aggregate.request), userId, clock.now())
    if (input.templates !== undefined) replaceDocuments(db, companyId, requestId, resolveDocuments(db, companyId, input.templates))
    if (input.recipient !== undefined) saveRecipient(db, buildRecipient(db, companyId, requestId, input.recipient, aggregate.recipient))
  })
  if (input.send === true) return sendESignRequest(context, companyId, requestId, userId, expectedVersion, input.due_date)
  return requireAggregate(db, companyId, requestId)
}

/**
 * Sends a draft to its recipient: `draft → pending`, or `draft → send_failed` when the email is rejected.
 *
 * The signing token is generated and mailed before the status transaction;
 * only its hash is stored. A version conflict at commit leaves the mailed link unusable.
 *
 * @param dueDate A due date chosen on the confirmation modal, or `null` for the saved or default one.
 */
export async function sendESignRequest(
  context: HrContext,
  companyId: string,
  requestId: number,
  userId: string,
  expectedVersion: number | null,
  dueDate: PlainDate | null,
): Promise<ESignRequestAggregate> {
  const { db, clock } = context.deps
  const aggregate = requireAggregate(db, companyId, requestId)
  const { request, recipient } = aggregate
  if (request.status !== 'draft') throw invalidState('e-sign request', request.status)
  if (expectedVersion !== null && request.version !== expectedVersion) throw staleVersion('e-sign request')
  const sealId = validateForSend(db, aggregate)
  const due = dueDate ?? (request.due_date as PlainDate | null) ?? addDays(clock.today(), ESIGN_DUE_DAYS)
  if (due < clock.today()) throw invalidField('due_date', 'The due date cannot be in the past.')
  const token = createSecret()
  const vars = { ...messageVars(db, aggregate), signing_url: `${SIGNING_URL_BASE}${token}`, due_date: due }
  const source = { type: 'e_sign_request' as const, id: requestId }
  const email = await sendLogged(context, companyId, source, { channel: 'email', to: recipient.email ?? '', template: 'e_sign_request', vars })
  if (email.ok && recipient.phone !== null) await sendLogged(context, companyId, source, { channel: 'alimtalk', to: recipient.phone, template: 'e_sign_request', vars })
  const now = clock.now()
  transaction(db, () => {
    const seal = requireActiveSeal(db, companyId, sealId, 'company_seal')
    const patch: ESignRequestPatch = email.ok
      ? { token_hash: hashSecret(token), due_date: due, sent_at: now, send_error: null, company_seal_file_id: seal.file_id, updated_by: userId }
      : { token_hash: null, send_error: email.error, company_seal_file_id: null, updated_by: userId }
    if (!transitionRequest(db, companyId, requestId, ['draft'], email.ok ? 'pending' : 'send_failed', request.version, patch, now)) {
      throw staleVersion('e-sign request')
    }
    if (request.company_seal_id === null) db.prepare('UPDATE esign_requests SET company_seal_id = ? WHERE id = ?').run(sealId, requestId)
    insertRequestEvent(db, request, email.ok ? 'sent' : 'send_failed', { type: 'user', id: userId }, { ip: null, userAgent: null }, email.ok ? { due_date: due } : null, now)
  })
  return requireAggregate(db, companyId, requestId)
}

/** Cancels a request the worker has not finished signing: `pending | in_progress → cancelled`. */
export function cancelESignRequest(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  return applyTransition(context, companyId, requestId, ['pending', 'in_progress'], 'cancelled', userId, expectedVersion, (now) => ({ cancelled_at: now }))
}

/** Voids a completed contract: `completed → voided`. */
export function voidESignRequest(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  return applyTransition(context, companyId, requestId, ['completed'], 'voided', userId, expectedVersion, (now) => ({ voided_at: now }))
}

/** Returns a cancelled, expired or failed request to draft so it can be edited and sent again (재발송). */
export function revertESignRequestToDraft(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  const aggregate = applyTransition(context, companyId, requestId, ['cancelled', 'expired', 'send_failed'], 'draft', userId, expectedVersion, () => ({
    token_hash: null,
    due_date: null,
    sent_at: null,
    verified_at: null,
    expired_at: null,
    cancelled_at: null,
    send_error: null,
    verify_failures: 0,
    company_seal_file_id: null,
  }))
  context.deps.db.prepare('DELETE FROM esign_signer_seals WHERE request_id = ?').run(requestId)
  return aggregate
}

/**
 * Deletes a request that is not in progress.
 *
 * @throws {DomainError} `INVALID_TRANSITION` for pending, in-progress, completed and voided requests (rule R25).
 */
export function deleteESignRequest(context: HrContext, companyId: string, requestId: number): void {
  const { db } = context.deps
  transaction(db, () => {
    const request = findRequest(db, companyId, requestId)
    if (request === undefined) throw notFound('E-sign request')
    if (!deleteRequest(db, companyId, requestId, DELETABLE)) throw invalidState('e-sign request', request.status)
  })
}

/** Reads the signed PDF of a completed request. */
export async function readESignResult(context: HrContext, companyId: string, requestId: number): Promise<HrFileDownload> {
  const request = findRequest(context.deps.db, companyId, requestId)
  if (request === undefined) throw notFound('E-sign request')
  if (request.status !== 'completed' || request.result_file_id === null) throw invalidState('e-sign request', request.status)
  return readHrFile(context.deps, companyId, request.result_file_id)
}

/** Loads a request with its documents and recipient, or throws `NOT_FOUND`. */
export function requireAggregate(db: DatabaseSync, companyId: string, requestId: number): ESignRequestAggregate {
  const request = findRequest(db, companyId, requestId)
  if (request === undefined) throw notFound('E-sign request')
  return loadAggregate(db, request)
}

/** Template variables shared by e-sign notifications. */
export function messageVars(db: DatabaseSync, aggregate: ESignRequestAggregate): Record<string, string> {
  return {
    company_name: findCompany(db, aggregate.request.company_id)?.name ?? '',
    recipient_name: aggregate.recipient.name,
    title: aggregate.documents[0]?.title ?? '',
    due_date: aggregate.request.due_date ?? '',
  }
}

function applyTransition(
  context: HrContext,
  companyId: string,
  requestId: number,
  from: readonly ESignRequestStatus[],
  to: ESignRequestStatus,
  userId: string,
  expectedVersion: number,
  patch: (now: string) => ESignRequestPatch,
): ESignRequestAggregate {
  const { db, clock } = context.deps
  return transaction(db, () => {
    const request = findRequest(db, companyId, requestId)
    if (request === undefined) throw notFound('E-sign request')
    if (!from.includes(request.status)) throw invalidState('e-sign request', request.status)
    if (request.version !== expectedVersion) throw staleVersion('e-sign request')
    const now = clock.now()
    if (!transitionRequest(db, companyId, requestId, from, to, expectedVersion, { ...patch(now), updated_by: userId }, now)) throw staleVersion('e-sign request')
    deleteSignerSessions(db, requestId)
    insertRequestEvent(db, request, to, { type: 'user', id: userId }, { ip: null, userAgent: null }, { from: request.status }, now)
    return requireAggregate(db, companyId, requestId)
  })
}

function draftValues(input: DraftInput, current: ESignRequestRow | null): Parameters<typeof insertDraft>[2] {
  return {
    workplace_size: input.workplace_size === undefined ? (current?.workplace_size ?? null) : input.workplace_size,
    wage_type: input.wage_type === undefined ? (current?.wage_type ?? null) : input.wage_type,
    work_condition_id: input.work_condition === undefined ? (current?.work_condition_id ?? null) : input.work_condition,
    work_schedule_policy_id: input.work_schedule_policy === undefined ? (current?.work_schedule_policy_id ?? null) : input.work_schedule_policy,
    field_values: input.field_values === undefined ? (current?.field_values ?? '{}') : JSON.stringify(input.field_values),
    company_seal_id: input.company_seal === undefined ? (current?.company_seal_id ?? null) : input.company_seal,
    due_date: input.due_date ?? current?.due_date ?? null,
  }
}

function resolveDocuments(
  db: DatabaseSync,
  companyId: string,
  templates: readonly { template_id: number }[],
): Parameters<typeof replaceDocuments>[3] {
  return templates.map((reference, index) => {
    const template = findTemplate(db, companyId, reference.template_id)
    if (template === undefined || template.is_certificate) throw invalidField(`templates.${index}.template_id`, 'Unknown e-sign template.')
    return {
      doc_index: index,
      template_id: template.id,
      template_type: template.template_type,
      title: template.title,
      document_kind: template.document_kind,
      category: template.category,
    }
  })
}

function buildRecipient(db: DatabaseSync, companyId: string, requestId: number, input: RecipientInput, current: ESignRecipientRow | null): ESignRecipientRow {
  const employeeId = input.employee_id === undefined ? (current?.employee_id ?? null) : input.employee_id
  let employee: EmployeeRow | undefined
  let employmentType = input.employment_type === undefined ? (current?.employment_type ?? null) : input.employment_type
  if (employeeId !== null) {
    employee = findEmployeeRow(db, companyId, employeeId)
    if (employee === undefined) throw invalidField('recipient.employee_id', 'Unknown employee.')
    if (employmentType !== null && fromEmploymentType(employmentType) !== employee.kind) throw invalidField('recipient.employment_type', 'Does not match the employee.')
    employmentType = toEmploymentType(employee.kind)
  }
  const name = input.name ?? employee?.name ?? current?.name
  if (name === undefined) throw invalidField('recipient.name', 'Enter the recipient name.')
  return {
    company_id: companyId,
    request_id: requestId,
    employment_type: employmentType,
    employee_id: employeeId,
    name,
    email: input.email ?? employee?.email ?? null,
    phone: input.phone ?? employee?.phone ?? null,
    is_local: employee === undefined ? toFlag(input.is_local) : employee.is_local,
    nationality: input.nationality ?? employee?.nationality ?? null,
    visa: input.visa ?? employee?.visa ?? null,
    birth_date: input.birth_date ?? employee?.birth_date ?? null,
  }
}

function validateForSend(db: DatabaseSync, aggregate: ESignRequestAggregate): number {
  const { request, recipient, documents } = aggregate
  if (recipient.email === null) throw invalidField('recipient.email', 'An email address is required to send the request.')
  if (recipient.is_local === 0) {
    if (recipient.nationality === null) throw invalidField('recipient.nationality', 'Foreign recipients need a nationality.')
    if (recipient.visa === null) throw invalidField('recipient.visa', 'Foreign recipients need a residence status.')
  }
  if (documents.length === 0) throw invalidField('templates', 'Choose at least one template.')
  const fieldValues = JSON.parse(request.field_values) as FieldValueMap
  const employee = recipient.employee_id === null ? undefined : findEmployeeRow(db, request.company_id, recipient.employee_id)
  let defaultSeal: number | null = null
  for (const document of documents) {
    const template = findTemplate(db, request.company_id, document.template_id)
    if (template === undefined || !template.is_active) throw invalidField(`templates.${document.doc_index}`, 'This template is turned off.')
    defaultSeal ??= template.default_seal_id
    assertRequiredFields(template, fieldValues[String(document.doc_index)] ?? {}, employee, document.doc_index)
  }
  const sealId = request.company_seal_id ?? defaultSeal
  if (sealId === null) throw invalidField('company_seal', 'Choose the company seal to stamp.')
  requireActiveSeal(db, request.company_id, sealId, 'company_seal')
  return sealId
}

function assertRequiredFields(template: ResolvedTemplate, values: Record<string, unknown>, employee: EmployeeRow | undefined, index: number): void {
  const hidden = Array.isArray(values['__hidden']) ? (values['__hidden'] as unknown[]) : []
  for (const field of template.fields) {
    if (!field.required || field.signer || hidden.includes(field.key)) continue
    const value = values[field.key] ?? field.default ?? sourceValue(field.source, employee)
    if (value === null || value === undefined || value === '') throw invalidField(`field_values.${index}.${field.key}`, `${field.label} is required.`)
  }
}

function sourceValue(source: string | null, employee: EmployeeRow | undefined): unknown {
  if (source === null || employee === undefined || !source.startsWith('employee.')) return null
  return (employee as unknown as Record<string, unknown>)[source.slice('employee.'.length)] ?? null
}
