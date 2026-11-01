import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '../../../db/query'
import { toSeoulIso } from '../../../lib/clock'
import { invalidField, notFound } from '../../../lib/domain-error'
import { findCompany } from '../../companies/companies.repository'
import { insertEmployeeDocument } from '../documents/documents.repository'
import { findEmployeeView, revealRegistrationNumber } from '../employees/employees.repository'
import type { EmployeeView } from '../employees/employees.types'
import { sendLogged } from '../e-sign/e-sign-notify'
import { findTemplate, requireActiveSeal } from '../e-sign/e-sign-settings.service'
import { createSecret, hashSecret, maskName, MAX_VERIFY_FAILURES, SIGNER_SESSION_MINUTES } from '../e-sign/e-sign.utils'
import type { HrContext } from '../shared/hr-context.types'
import { HrError } from '../shared/hr-error'
import { commitHrFile, DOCUMENT_MIME_TYPES, prepareHrFile, readHrFile, type HrFileDownload } from '../shared/hr-files'
import { fromEmploymentType, invalidState, staleVersion } from '../shared/hr.utils'
import { maskIdentificationNumber } from '../shared/registration-number'
import { zipStored } from '../shared/xlsx-writer'
import {
  countCertificatesByStatus,
  deleteCertificate,
  deleteCertificateSessions,
  findCertificate,
  findCertificateByTokenHash,
  hasLiveCertificateSession,
  insertCertificate,
  insertCertificateSession,
  listCertificates,
  nextIssueNumber,
  recordCertificateVerifyFailure,
  transitionCertificate,
} from './certificates.repository'
import type { CertificateFilter, CertificateRow, CertificateStatus, IssueCertificateInput } from './certificates.types'

/** Days a certificate download link stays valid after sending. */
export const CERTIFICATE_LINK_DAYS = 30

/** Base URL of the worker certificate screen used in notification links. */
export const CERTIFICATE_URL_BASE = 'https://app.alfred.kr/certificates/worker/'

const SENDABLE: readonly CertificateStatus[] = ['issued', 'send_failed', 'sent']

/** A file to download, possibly a ZIP of several certificates. */
export interface CertificateDownload {
  name: string
  mimeType: string
  data: Uint8Array
}

/**
 * Issues a certificate: fills the template from the employee record, renders the PDF and stores it as `issued`.
 *
 * Wage employees also get the PDF in their document box.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown templates, employees or seals, and for a retirement certificate of an employee who has not left.
 */
export async function issueCertificate(context: HrContext, companyId: string, input: IssueCertificateInput, userId: string): Promise<CertificateRow> {
  const { db, clock, cipher } = context.deps
  const template = findTemplate(db, companyId, input.template)
  if (template === undefined || !template.is_certificate || !template.is_active) throw invalidField('template', 'Choose an active certificate template.')
  const employee = findEmployeeView(db, companyId, input.employee_id, clock.today())
  if (employee === undefined || employee.kind !== fromEmploymentType(input.employment_type)) throw invalidField('employee_id', 'Unknown employee.')
  if (template.document_kind === 'retirement_certificate' && employee.leave_date === null) {
    throw invalidField('employee_id', 'A retirement certificate needs the employee to have a leave date.')
  }
  const sealId = input.company_seal ?? template.default_seal_id
  const seal = sealId === null ? null : requireActiveSeal(db, companyId, sealId, 'company_seal')
  const registration = revealRegistrationNumber(db, cipher, companyId, employee.id)
  const values: Record<string, unknown> = {
    ...autoFill(employee, registration === null ? null : maskIdentificationNumber(registration, employee.identification_number_type)),
    company_name: findCompany(db, companyId)?.name ?? '',
    issue_date: clock.today(),
    ...input.field_values,
  }
  for (const field of template.fields) {
    if (field.required && (values[field.key] === undefined || values[field.key] === null || values[field.key] === '')) {
      throw invalidField(`field_values.${field.key}`, `${field.label} is required.`)
    }
  }
  const images = seal === null ? [] : [(await readHrFile(context.deps, companyId, seal.file_id)).data]
  const issueNumber = nextIssueNumber(db, companyId, Number(clock.today().slice(0, 4)))
  const pdf = await context.adapters.pdfRenderer.render({
    title: template.title,
    sections: [{ heading: `발급번호 ${issueNumber}`, lines: Object.entries(values).map(([key, value]) => `${key}: ${String(value ?? '')}`) }],
    images,
    auditTrail: [`issued ${clock.now()}`],
  })
  const fileName = `${template.title}_${employee.name}.pdf`
  const prepared = await prepareHrFile(context.deps, companyId, { name: fileName, bytes: pdf }, userId, DOCUMENT_MIME_TYPES)
  return commitHrFile(context.deps, prepared, (file) => {
    const now = clock.now()
    const id = insertCertificate(db, {
      company_id: companyId,
      template_id: template.id,
      title: template.title,
      employment_type: input.employment_type,
      employee_id: employee.id,
      employee_name: employee.name,
      field_values: JSON.stringify(values),
      company_seal_id: seal?.id ?? null,
      issue_number: issueNumber,
      issued_at: now,
      file_id: file.id,
      created_by: userId,
      created_at: now,
    })
    if (employee.kind === 'wage-salary') {
      insertEmployeeDocument(db, {
        companyId,
        employeeId: employee.id,
        category: 'certificate',
        sourceType: 'certificate',
        sourceId: id,
        fileId: file.id,
        fileName,
        createdBy: userId,
        now,
      })
    }
    return requireCertificate(db, companyId, id)
  })
}

/**
 * Sends a certificate link to the employee: `issued | send_failed | sent → sending → sent | send_failed`.
 *
 * The `sending` state is committed before the provider is called, so a
 * concurrent send fails its version check instead of mailing twice.
 */
export async function sendCertificate(
  context: HrContext,
  companyId: string,
  certificateId: number,
  override: { email?: string | undefined; phone?: string | undefined } | undefined,
  expectedVersion: number,
): Promise<CertificateRow> {
  const { db, clock } = context.deps
  const certificate = requireCertificate(db, companyId, certificateId)
  if (!SENDABLE.includes(certificate.status)) throw invalidState('certificate', certificate.status)
  if (certificate.version !== expectedVersion) throw staleVersion('certificate')
  const employee = findEmployeeView(db, companyId, certificate.employee_id, clock.today())
  const email = override?.email ?? employee?.email ?? null
  const phone = override?.phone ?? employee?.phone ?? null
  if (email === null && phone === null) throw invalidField('email', 'Enter an email address or phone number to send to.')
  const token = createSecret()
  const now = clock.now()
  const expiresAt = toSeoulIso(new Date(Date.parse(now) + CERTIFICATE_LINK_DAYS * 86_400_000))
  transaction(db, () => {
    const patch = { sent_to_email: email, sent_to_phone: phone, send_error: null, token_hash: null, token_expires_at: null }
    if (!transitionCertificate(db, companyId, certificateId, SENDABLE, 'sending', expectedVersion, patch, now)) throw staleVersion('certificate')
    deleteCertificateSessions(db, certificateId)
  })
  const vars = {
    company_name: findCompany(db, companyId)?.name ?? '',
    recipient_name: certificate.employee_name,
    title: certificate.title,
    certificate_url: `${CERTIFICATE_URL_BASE}${token}`,
    expires_at: expiresAt,
  }
  const source = { type: 'certificate' as const, id: certificateId }
  const results = [
    ...(email === null ? [] : [await sendLogged(context, companyId, source, { channel: 'email', to: email, template: 'certificate_issued', vars })]),
    ...(phone === null ? [] : [await sendLogged(context, companyId, source, { channel: 'alimtalk', to: phone, template: 'certificate_issued', vars })]),
  ]
  const delivered = results.some((result) => result.ok)
  const error = results.find((result) => !result.ok)
  transaction(db, () => {
    const patch = delivered
      ? { token_hash: hashSecret(token), token_expires_at: expiresAt, sent_at: clock.now(), verify_failures: 0 }
      : { send_error: error !== undefined && !error.ok ? error.error : 'Delivery failed.' }
    transitionCertificate(db, companyId, certificateId, ['sending'], delivered ? 'sent' : 'send_failed', null, patch, clock.now())
  })
  return requireCertificate(db, companyId, certificateId)
}

/** Lists a page of certificates. */
export function listCertificatePage(db: DatabaseSync, companyId: string, filter: CertificateFilter, limit: number, offset: number): { rows: CertificateRow[]; count: number } {
  return listCertificates(db, companyId, filter, limit, offset)
}

/** Counts certificates per status for the list tabs. */
export function certificateCounts(db: DatabaseSync, companyId: string, filter: CertificateFilter): Record<CertificateStatus | 'all', number> {
  return countCertificatesByStatus(db, companyId, filter)
}

/** Deletes a certificate in any status; its download link stops working. */
export function removeCertificate(db: DatabaseSync, companyId: string, certificateId: number): void {
  if (!transaction(db, () => deleteCertificate(db, companyId, certificateId))) throw notFound('Certificate')
}

/**
 * Downloads one certificate as PDF, or several as a ZIP of PDFs.
 *
 * @throws {DomainError} `NOT_FOUND` when any ID is not a certificate of the company.
 */
export async function downloadCertificates(context: HrContext, companyId: string, ids: readonly number[]): Promise<CertificateDownload> {
  const certificates = [...new Set(ids)].map((id) => requireCertificate(context.deps.db, companyId, id))
  const files = await Promise.all(certificates.map(async (certificate) => ({ certificate, download: await readHrFile(context.deps, companyId, certificate.file_id) })))
  const only = files[0]
  if (files.length === 1 && only !== undefined) return { name: only.download.file.original_name, mimeType: 'application/pdf', data: only.download.data }
  const entries = files.map(({ certificate, download }) => ({ name: `${certificate.issue_number}_${download.file.original_name}`, data: download.data }))
  return { name: `certificates_${context.deps.clock.today()}.zip`, mimeType: 'application/zip', data: zipStored(entries) }
}

/** Loads a certificate or throws `NOT_FOUND`. */
export function requireCertificate(db: DatabaseSync, companyId: string, certificateId: number): CertificateRow {
  const certificate = findCertificate(db, companyId, certificateId)
  if (certificate === undefined) throw notFound('Certificate')
  return certificate
}

/**
 * Resolves a certificate download token.
 *
 * @throws {HrError} `SIGNING_TOKEN_INVALID` for unknown tokens.
 */
export function resolveCertificateToken(db: DatabaseSync, token: string): CertificateRow {
  const certificate = findCertificateByTokenHash(db, hashSecret(token))
  if (certificate === undefined) throw new HrError('SIGNING_TOKEN_INVALID', 'This certificate link is not valid.')
  return certificate
}

/** Builds the entry summary of a certificate link, reporting `expired` once the link has lapsed. */
export function certificateSummary(context: HrContext, certificate: CertificateRow): Record<string, unknown> {
  return {
    status: isLinkExpired(context, certificate) ? 'expired' : certificate.status,
    company_name: findCompany(context.deps.db, certificate.company_id)?.name ?? null,
    employee_name: maskName(certificate.employee_name),
    title: certificate.title,
    issue_number: certificate.issue_number,
    issued_at: certificate.issued_at,
    token_expires_at: certificate.token_expires_at,
  }
}

/**
 * Checks the recipient's identity against the employee record and opens a session.
 *
 * @throws {HrError} `SIGNING_CLOSED`, `IDENTITY_VERIFICATION_LOCKED` or `IDENTITY_VERIFICATION_FAILED`.
 */
export async function verifyCertificateRecipient(
  context: HrContext,
  certificate: CertificateRow,
  claim: { name: string; birth_date?: string | undefined },
  origin: { ip: string | null; userAgent: string | null },
): Promise<{ session_token: string; expires_at: string }> {
  const { db, clock } = context.deps
  assertLinkOpen(context, certificate)
  if (certificate.verify_failures >= MAX_VERIFY_FAILURES) {
    throw new HrError('IDENTITY_VERIFICATION_LOCKED', 'Too many failed attempts. Ask the company to send the certificate again.')
  }
  const employee = findEmployeeView(db, certificate.company_id, certificate.employee_id, clock.today())
  const ok = await context.adapters.identityVerifier.verify({ name: certificate.employee_name, birthDate: employee?.birth_date ?? null }, claim)
  if (!ok) {
    const failures = transaction(db, () => recordCertificateVerifyFailure(db, certificate.id))
    throw new HrError('IDENTITY_VERIFICATION_FAILED', 'The name or birth date does not match.', { remaining_attempts: Math.max(0, MAX_VERIFY_FAILURES - failures) })
  }
  const session = createSecret()
  const now = clock.now()
  const expiresAt = toSeoulIso(new Date(Date.parse(now) + SIGNER_SESSION_MINUTES * 60_000))
  transaction(db, () => insertCertificateSession(db, certificate, hashSecret(session), origin, now, expiresAt))
  return { session_token: session, expires_at: expiresAt }
}

/**
 * Reads the certificate PDF for a verified recipient.
 *
 * @throws {HrError} `SIGNING_CLOSED`, `SIGNER_SESSION_REQUIRED` or `SIGNER_SESSION_INVALID`.
 */
export async function readCertificateForRecipient(context: HrContext, certificate: CertificateRow, sessionHeader: string | undefined): Promise<HrFileDownload> {
  assertLinkOpen(context, certificate)
  if (sessionHeader === undefined || sessionHeader.trim() === '') throw new HrError('SIGNER_SESSION_REQUIRED', 'Verify your identity first.')
  if (!hasLiveCertificateSession(context.deps.db, certificate.id, hashSecret(sessionHeader.trim()), context.deps.clock.now())) {
    throw new HrError('SIGNER_SESSION_INVALID', 'Your session has expired. Verify your identity again.')
  }
  return readHrFile(context.deps, certificate.company_id, certificate.file_id)
}

function autoFill(employee: EmployeeView, maskedRegistration: string | null): Record<string, unknown> {
  return {
    name: employee.name,
    birth_date: employee.birth_date,
    registration_number: maskedRegistration,
    department: employee.department_name,
    position: employee.position_name,
    join_date: employee.join_date,
    leave_date: employee.leave_date,
    work_code: employee.work_code,
  }
}

function isLinkExpired(context: HrContext, certificate: CertificateRow): boolean {
  return certificate.token_expires_at !== null && certificate.token_expires_at <= context.deps.clock.now()
}

function assertLinkOpen(context: HrContext, certificate: CertificateRow): void {
  if (isLinkExpired(context, certificate)) throw new HrError('SIGNING_CLOSED', 'This certificate link has expired.', { status: 'expired' })
  if (certificate.status !== 'sent') throw new HrError('SIGNING_CLOSED', `This certificate is ${certificate.status}.`, { status: certificate.status })
}
