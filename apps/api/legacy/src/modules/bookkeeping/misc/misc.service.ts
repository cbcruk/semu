import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AppDeps } from '../../../app.types'
import { execute, queryAll, queryOne, transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { sniffMimeType } from '../../../lib/file-storage/sniff-mime'
import type { CompanyRow } from '../../companies/companies.types'
import { findFile, findFileBySha, insertFile } from '../../filings/filings.repository'
import type { FileRow } from '../../filings/filings.types'
import { hometaxAdapterOf } from '../transaction-sales/transaction-sales.service'
import type { BusinessTypeRow, ShareHistoryRow } from './misc.types'
import { signUploadToken, verifyUploadToken } from './misc.utils'

const UPLOAD_URL_TTL_SECONDS = 10 * 60
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const ATTACHMENT_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'application/pdf']

/** Public path prefix of the signed upload target. */
export const ATTACHMENT_UPLOAD_PATH = '/api/attachments/upload'

/** Returns the stable `file_path` reference of a stored file. */
export function filePathOf(fileId: string): string {
  return `files/${fileId}`
}

/**
 * Issues a signed URL the client PUTs an attachment to, valid for ten minutes.
 *
 * @param origin The scheme and host of the current request, used to build an absolute URL.
 */
export function issueUploadUrl(
  deps: Pick<AppDeps, 'clock' | 'jwtSecret'>,
  companyId: string,
  userId: string,
  fileName: string,
  origin: string,
): { upload_url: string; file_path: string; file_id: string; expires_at: string } {
  const fileId = randomUUID()
  const expiresAt = Math.floor(Date.parse(deps.clock.now()) / 1000) + UPLOAD_URL_TTL_SECONDS
  const token = signUploadToken(deps.jwtSecret, { companyId, userId, fileId, fileName, expiresAt })
  return {
    upload_url: `${origin}${ATTACHMENT_UPLOAD_PATH}/${token}`,
    file_path: filePathOf(fileId),
    file_id: fileId,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  }
}

/**
 * Stores the bytes PUT to a signed upload URL as a company file.
 *
 * Identical content already stored for the company is reused, in which case
 * the returned `file_path` points at the earlier file rather than the reserved ID.
 *
 * @throws {DomainError} `UNAUTHENTICATED` for a forged or expired token, `INVALID_TRANSITION` when the token was used,
 * `UNSUPPORTED_MEDIA_TYPE` unless the content is JPG, PNG or PDF, `PAYLOAD_TOO_LARGE` above 10 MB.
 */
export async function storeSignedUpload(
  deps: Pick<AppDeps, 'db' | 'clock' | 'storage' | 'jwtSecret'>,
  token: string,
  bytes: Uint8Array,
): Promise<{ id: string; file_name: string; file_path: string; mime_type: string; size_bytes: number }> {
  const payload = verifyUploadToken(deps.jwtSecret, token, Math.floor(Date.parse(deps.clock.now()) / 1000))
  if (payload === null) throw new DomainError('UNAUTHENTICATED', 'The upload URL is invalid or has expired.')
  if (findFile(deps.db, payload.companyId, payload.fileId) !== undefined) throw new DomainError('INVALID_TRANSITION', 'The upload URL was already used.')
  if (bytes.byteLength === 0) throw invalidField('file', 'Attach a non-empty file.')
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 'Attachments must be 10 MB or smaller.')
  const mimeType = sniffMimeType(bytes, payload.fileName)
  if (mimeType === null || !ATTACHMENT_MIME_TYPES.includes(mimeType)) {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Only JPG, PNG and PDF files are accepted.')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = findFileBySha(deps.db, payload.companyId, sha256)
  if (existing !== undefined) return describeFile(existing)
  const file: FileRow = {
    id: payload.fileId,
    company_id: payload.companyId,
    storage_key: `${payload.companyId}/${payload.fileId}`,
    original_name: payload.fileName,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    sha256,
    uploaded_by: payload.userId,
    created_at: deps.clock.now(),
  }
  await deps.storage.put(file.storage_key, bytes)
  try {
    return describeFile(transaction(deps.db, () => insertFile(deps.db, file)))
  } catch (error) {
    await deps.storage.delete(file.storage_key).catch(() => undefined)
    throw error
  }
}

/** Reads a company file for download. */
export async function readAttachment(deps: Pick<AppDeps, 'db' | 'storage'>, companyId: string, fileId: string): Promise<{ file: FileRow; data: Uint8Array }> {
  const file = findFile(deps.db, companyId, fileId)
  if (file === undefined) throw notFound('File')
  return { file, data: await deps.storage.get(file.storage_key) }
}

/** Returns the most recent company information share in the legacy shape, or empty fields when there is none. */
export function recentShareHistory(db: DatabaseSync, companyId: string): Record<string, unknown> {
  const row = queryOne<ShareHistoryRow>(db, 'SELECT * FROM company_share_histories WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [
    companyId,
  ])
  if (row === undefined) return { id: null, created: null, receivers: [], share_info: null, representative_image: null, bankbook_image: null }
  return serializeShare(db, row)
}

/**
 * Records a company information share to partners.
 *
 * Mail delivery belongs to the platform notification module; this stores the
 * history that `share-histories/recent` pre-fills the next share from.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when an image ID is not a file of the company.
 */
export function shareCompanyInfo(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  companyId: string,
  userId: string,
  body: {
    receivers: string[]
    detail: { address?: string | null | undefined; email?: string | null | undefined; phone_number?: string | null | undefined }
    representative_image_id?: string | null | undefined
    bankbook_image_id?: string | null | undefined
  },
): Record<string, unknown> {
  for (const field of ['representative_image_id', 'bankbook_image_id'] as const) {
    const fileId = body[field]
    if (fileId !== undefined && fileId !== null && findFile(deps.db, companyId, fileId) === undefined) throw invalidField(field, 'Unknown file.')
  }
  const id = randomUUID()
  const detail = { address: body.detail.address ?? null, email: body.detail.email ?? null, phone_number: body.detail.phone_number ?? null }
  execute(
    deps.db,
    `INSERT INTO company_share_histories (id, company_id, receivers, detail, representative_image_id, bankbook_image_id, sent_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, companyId, JSON.stringify(body.receivers), JSON.stringify(detail), body.representative_image_id ?? null, body.bankbook_image_id ?? null, userId, deps.clock.now()],
  )
  const row = queryOne<ShareHistoryRow>(deps.db, 'SELECT * FROM company_share_histories WHERE id = ?', [id])
  if (row === undefined) throw notFound('Share history')
  return serializeShare(deps.db, row)
}

/** Lists a company's registered 업태·종목, main registration first. */
export function listBusinessTypes(db: DatabaseSync, companyId: string): { business_type: string; business_class: string; code: string; is_main: boolean }[] {
  return queryAll<BusinessTypeRow>(db, 'SELECT * FROM company_business_types WHERE company_id = ? ORDER BY is_main DESC, seq', [companyId]).map((row) => ({
    business_type: row.business_type,
    business_class: row.business_class,
    code: row.code,
    is_main: row.is_main === 1,
  }))
}

/** Re-collects a company's 업태·종목 from Hometax and replaces the stored list. */
export async function refreshBusinessTypes(
  deps: Pick<AppDeps, 'db' | 'clock' | 'hometaxInvoice'>,
  company: CompanyRow,
): Promise<ReturnType<typeof listBusinessTypes>> {
  const records = await hometaxAdapterOf(deps).fetchBusinessTypes(company.business_number.replaceAll('-', ''))
  const now = deps.clock.now()
  transaction(deps.db, () => {
    execute(deps.db, 'DELETE FROM company_business_types WHERE company_id = ?', [company.id])
    records.forEach((record, index) => {
      execute(
        deps.db,
        'INSERT INTO company_business_types (company_id, seq, code, business_type, business_class, is_main, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [company.id, index + 1, record.code, record.business_type, record.business_class, record.is_main ? 1 : 0, now],
      )
    })
  })
  return listBusinessTypes(deps.db, company.id)
}

/**
 * Returns freshness metadata for the home management cards.
 *
 * The meaning of the legacy `home/ssb/meta` is unconfirmed; this answers with
 * the collection schedule shown on the cards and the latest sync times.
 */
export function homeSsbMeta(deps: Pick<AppDeps, 'db' | 'clock'>, companyId: string): Record<string, unknown> {
  const latest = (sql: string): string | null => queryOne<{ at: string | null }>(deps.db, sql, [companyId])?.at ?? null
  return {
    cash_report_as_of: '06:00',
    pg_delivery_reflect_at: '11:00',
    classification_reflect_minutes: 10,
    last_synced_at: {
      sales_evidence: latest('SELECT MAX(synced_at) AS at FROM sales_evidence WHERE company_id = ?'),
      purchase_evidence: latest('SELECT MAX(synced_at) AS at FROM purchase_evidence WHERE company_id = ?'),
      bank_transactions: latest('SELECT MAX(synced_at) AS at FROM bank_transactions WHERE company_id = ?'),
    },
    as_of: deps.clock.now(),
  }
}

function describeFile(file: FileRow): { id: string; file_name: string; file_path: string; mime_type: string; size_bytes: number } {
  return { id: file.id, file_name: file.original_name, file_path: filePathOf(file.id), mime_type: file.mime_type, size_bytes: file.size_bytes }
}

function serializeShare(db: DatabaseSync, row: ShareHistoryRow): Record<string, unknown> {
  const image = (fileId: string | null): { id: string; file_name: string; file_path: string } | null => {
    if (fileId === null) return null
    const file = findFile(db, row.company_id, fileId)
    return file === undefined ? null : { id: file.id, file_name: file.original_name, file_path: filePathOf(file.id) }
  }
  return {
    id: row.id,
    created: row.created_at,
    receivers: JSON.parse(row.receivers) as string[],
    share_info: { detail: JSON.parse(row.detail) as Record<string, unknown> },
    representative_image: image(row.representative_image_id),
    bankbook_image: image(row.bankbook_image_id),
  }
}
