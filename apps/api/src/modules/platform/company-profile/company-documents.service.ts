import { createHash, randomUUID } from 'node:crypto'
import type { AuthUser, ServiceDeps } from '../../../app.types'
import { execute, queryOne, transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { sniffMimeType } from '../../../lib/file-storage/sniff-mime'
import { findFile, findFileBySha, insertFile } from '../../filings/filings.repository'
import type { FileRow } from '../../filings/filings.types'
import { findCompanyContract } from '../contracts/contracts.repository'
import { renderContract } from '../contracts/contracts.utils'

/** Attachment names, used verbatim as the `name` query value (B:73073). */
export const ATTACHMENT_NAMES = ['CMS동의서', '건강보험대행동의서', '고용보험대행동의서', '국민연금대행동의서', '사업자등록증', '이전세무전산자료'] as const

/** Contract names, used verbatim as the `name` query value (B:73081). */
export const CONTRACT_NAMES = ['수임계약서', '4대보험대행동의약관'] as const

/** Downloadable blank forms of the bookkeeping service materials tab. */
const ATTACHMENT_FORMS = [
  { name: 'CMS동의서', file_name: 'CMS_출금이체_동의서.pdf', url: '/static/forms/cms-consent.pdf' },
  { name: '건강보험대행동의서', file_name: '건강보험_업무대행_동의서.pdf', url: '/static/forms/health-insurance-delegation.pdf' },
  { name: '국민연금대행동의서', file_name: '국민연금_업무대행_동의서.pdf', url: '/static/forms/national-pension-delegation.pdf' },
  { name: '고용보험대행동의서', file_name: '고용보험_업무대행_동의서.pdf', url: '/static/forms/employment-insurance-delegation.pdf' },
] as const

/** Name of a company attachment. */
export type AttachmentName = (typeof ATTACHMENT_NAMES)[number]

/** Checks whether a string is a known attachment name. */
export function isAttachmentName(value: string): value is AttachmentName {
  return (ATTACHMENT_NAMES as readonly string[]).includes(value)
}

/** Returns the current file of an attachment, or `null` when none was uploaded. */
export function getAttachment(deps: ServiceDeps, companyId: string, name: AttachmentName): Record<string, unknown> {
  const row = queryOne<{ file_id: string; uploaded_at: string; uploaded_by: string }>(
    deps.db,
    'SELECT file_id, uploaded_at, uploaded_by FROM company_attachments WHERE company_id = ? AND name = ?',
    [companyId, name],
  )
  const file = row === undefined ? undefined : findFile(deps.db, companyId, row.file_id)
  return {
    name,
    file:
      file === undefined || row === undefined
        ? null
        : { id: file.id, file_name: file.original_name, mime_type: file.mime_type, size_bytes: file.size_bytes, uploaded_at: row.uploaded_at },
    url: file === undefined ? null : `/api/settings/company/${companyId}/attachments/download?name=${encodeURIComponent(name)}`,
  }
}

/**
 * Stores an uploaded attachment, replacing the previous file of the same name.
 *
 * The blob is written before the metadata transaction; identical content is
 * stored once per company.
 *
 * @throws {DomainError} `UNSUPPORTED_MEDIA_TYPE` for disallowed contents.
 */
export async function putAttachment(deps: ServiceDeps, companyId: string, user: AuthUser, name: AttachmentName, upload: { name: string; bytes: Uint8Array }): Promise<Record<string, unknown>> {
  const mimeType = sniffMimeType(upload.bytes, upload.name)
  if (mimeType === null && name !== '이전세무전산자료') throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Only PDF, PNG, JPEG, XLSX and CSV files are accepted.')
  const sha256 = createHash('sha256').update(upload.bytes).digest('hex')
  const existing = findFileBySha(deps.db, companyId, sha256)
  const now = deps.clock.now()
  let file: FileRow
  if (existing !== undefined) {
    file = existing
  } else {
    const id = randomUUID()
    file = {
      id,
      company_id: companyId,
      storage_key: `company/${companyId}/${name}_${sha256.slice(0, 8)}`,
      original_name: upload.name,
      mime_type: mimeType ?? 'application/octet-stream',
      size_bytes: upload.bytes.byteLength,
      sha256,
      uploaded_by: user.id,
      created_at: now,
    }
    await deps.storage.put(file.storage_key, upload.bytes)
  }
  try {
    transaction(deps.db, () => {
      const stored = existing ?? insertFile(deps.db, file)
      execute(
        deps.db,
        `INSERT INTO company_attachments (company_id, name, file_id, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (company_id, name) DO UPDATE SET file_id = excluded.file_id, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at`,
        [companyId, name, stored.id, user.id, now],
      )
    })
  } catch (error) {
    if (existing === undefined) await deps.storage.delete(file.storage_key).catch(() => undefined)
    throw error
  }
  return getAttachment(deps, companyId, name)
}

/**
 * Reads an attachment's bytes for download.
 *
 * @throws {DomainError} `NOT_FOUND` when nothing was uploaded.
 */
export async function readAttachment(deps: ServiceDeps, companyId: string, name: AttachmentName): Promise<{ file: FileRow; data: Uint8Array }> {
  const row = queryOne<{ file_id: string }>(deps.db, 'SELECT file_id FROM company_attachments WHERE company_id = ? AND name = ?', [companyId, name])
  const file = row === undefined ? undefined : findFile(deps.db, companyId, row.file_id)
  if (file === undefined) throw notFound('Attachment')
  return { file, data: await deps.storage.get(file.storage_key) }
}

/** Lists the blank forms customers download, fill in and upload. */
export function attachmentForms(): readonly Record<string, string>[] {
  return ATTACHMENT_FORMS
}

/**
 * Returns a contract of the company: the online bookkeeping contract or the social insurance delegation terms.
 *
 * @throws {DomainError} `NOT_FOUND` when the company has no such contract.
 */
export function getCompanyContract(deps: ServiceDeps, companyId: string, name: string): Record<string, unknown> {
  if (!(CONTRACT_NAMES as readonly string[]).includes(name)) throw invalidField('name', 'Unknown contract name.')
  if (name === '4대보험대행동의약관') {
    return {
      name,
      kind: 'online',
      articles: [{ number: 1, title: '업무 대행', body: '회사는 4대 사회보험 취득·상실 신고와 보수총액 신고를 세무법인에 위임한다.' }],
    }
  }
  const contract = findCompanyContract(deps.db, companyId)
  if (contract === undefined) throw notFound('Contract')
  return renderContract(contract)
}

/** Reads the Hometax delegation (수임동의) the agency requested, optionally by ID. */
export function getHometaxDelegation(deps: ServiceDeps, companyId: string, agreementId: string | undefined): Record<string, unknown> {
  const row =
    agreementId === undefined
      ? queryOne<Record<string, string | null>>(deps.db, 'SELECT * FROM hometax_delegations WHERE company_id = ? ORDER BY requested_at DESC LIMIT 1', [companyId])
      : queryOne<Record<string, string | null>>(deps.db, 'SELECT * FROM hometax_delegations WHERE company_id = ? AND id = ?', [companyId, agreementId])
  if (row === undefined) throw notFound('Hometax delegation')
  return { id: row['id'], company_id: row['company_id'], agency_name: row['agency_name'], status: row['status'], requested_at: row['requested_at'], agreed_at: row['agreed_at'] }
}

/**
 * Records the customer's consent to the Hometax delegation.
 *
 * @throws {DomainError} `INVALID_TRANSITION` unless the delegation is still requested.
 */
export function agreeHometaxDelegation(deps: ServiceDeps, companyId: string, agreementId: string, userId: string): Record<string, unknown> {
  const current = getHometaxDelegation(deps, companyId, agreementId)
  if (current['status'] !== 'requested') throw new DomainError('INVALID_TRANSITION', 'This delegation is not waiting for consent.')
  execute(deps.db, "UPDATE hometax_delegations SET status = 'agreed', agreed_at = ?, agreed_by = ? WHERE id = ?", [deps.clock.now(), userId, agreementId])
  return getHometaxDelegation(deps, companyId, agreementId)
}
