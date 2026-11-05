import { createHash, randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import type { AllowedMimeType } from '../../../lib/file-storage/file-storage.types'
import { sniffMimeType } from '../../../lib/file-storage/sniff-mime'
import { findFile, findFileBySha, insertFile } from '../../filings/filings.repository'
import type { FileRow } from '../../filings/filings.types'

/** Largest HR attachment accepted, matching the 10MB limit shown in the document box. */
export const HR_MAX_FILE_BYTES = 10 * 1024 * 1024

/** File types accepted for HR documents and attachments. */
export const DOCUMENT_MIME_TYPES: readonly AllowedMimeType[] = ['application/pdf', 'image/png', 'image/jpeg']

/** File types accepted for seal and signature images. */
export const IMAGE_MIME_TYPES: readonly AllowedMimeType[] = ['image/png', 'image/jpeg']

/** A file part and the text fields of a multipart request. */
export interface HrUpload {
  name: string
  bytes: Uint8Array
  fields: Record<string, string>
}

/** A blob already written to storage, waiting for its metadata transaction. */
export interface PreparedFile {
  file: FileRow
  isNew: boolean
}

/** Stored bytes with the metadata needed to serve them. */
export interface HrFileDownload {
  file: FileRow
  data: Uint8Array
}

/**
 * Reads the first non-empty file part named by `keys` from a multipart request.
 *
 * The client sends FormData keys in snake_case and calls the image part
 * `image` on some screens and `file` on others, so callers list the names
 * they accept.
 *
 * @throws {DomainError} `UNSUPPORTED_MEDIA_TYPE` for non-multipart bodies, `VALIDATION_FAILED` when no file is attached.
 */
export async function readHrUpload(c: Context, keys: readonly string[] = ['file']): Promise<HrUpload> {
  const contentType = c.req.header('Content-Type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data.')
  }
  const body = await c.req.parseBody()
  const part = keys.map((key) => body[key]).find((value): value is File => value instanceof File && value.size > 0)
  if (part === undefined) throw invalidField(keys[0] ?? 'file', 'Attach a non-empty file.')
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) if (typeof value === 'string') fields[key] = value
  return { name: part.name, bytes: new Uint8Array(await part.arrayBuffer()), fields }
}

/**
 * Validates bytes and writes them to storage before any transaction starts.
 *
 * Identical content already stored for the company is reused instead of written again.
 *
 * @throws {DomainError} `UNSUPPORTED_MEDIA_TYPE` when the sniffed type is not allowed, `PAYLOAD_TOO_LARGE` above {@linkcode HR_MAX_FILE_BYTES}.
 */
export async function prepareHrFile(
  deps: ServiceDeps,
  companyId: string,
  upload: { name: string; bytes: Uint8Array },
  uploadedBy: string,
  allowed: readonly AllowedMimeType[],
): Promise<PreparedFile> {
  if (upload.bytes.byteLength > HR_MAX_FILE_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 'Files must be 10MB or smaller.')
  const mimeType = sniffMimeType(upload.bytes, upload.name)
  if (mimeType === null || !allowed.includes(mimeType)) {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', `Only ${allowed.map(labelOf).join(', ')} files are accepted.`)
  }
  const sha256 = createHash('sha256').update(upload.bytes).digest('hex')
  const existing = findFileBySha(deps.db, companyId, sha256)
  if (existing !== undefined) return { file: existing, isNew: false }
  const id = randomUUID()
  const file: FileRow = {
    id,
    company_id: companyId,
    storage_key: `${companyId}/hr/${id}`,
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

/**
 * Inserts the file row and runs `fn` in one transaction, deleting a fresh blob when it throws.
 *
 * @example Attaching an uploaded document
 * ```ts
 * import { commitHrFile, DOCUMENT_MIME_TYPES, prepareHrFile } from './hr-files'
 *
 * const prepared = await prepareHrFile(deps, companyId, upload, userId, DOCUMENT_MIME_TYPES)
 * const row = await commitHrFile(deps, prepared, (file) => insertDocument(deps.db, companyId, employeeId, file))
 * ```
 */
export async function commitHrFile<T>(deps: ServiceDeps, prepared: PreparedFile, fn: (file: FileRow) => T): Promise<T> {
  try {
    return transaction(deps.db, () => fn(prepared.isNew ? insertFile(deps.db, prepared.file) : prepared.file))
  } catch (error) {
    if (prepared.isNew) await deps.storage.delete(prepared.file.storage_key).catch(() => undefined)
    throw error
  }
}

/** Reads a company's stored file. */
export async function readHrFile(deps: ServiceDeps, companyId: string, fileId: string): Promise<HrFileDownload> {
  const file = findFile(deps.db, companyId, fileId)
  if (file === undefined) throw notFound('File')
  return { file, data: await deps.storage.get(file.storage_key) }
}

/** Looks up a company's file row. */
export function requireHrFileRow(deps: ServiceDeps, companyId: string, fileId: string): FileRow {
  const file = findFile(deps.db, companyId, fileId)
  if (file === undefined) throw notFound('File')
  return file
}

/** Returns a file reference as sent in JSON responses. */
export function serializeFileRef(file: FileRow): { id: string; file_name: string; mime_type: string; size: number } {
  return { id: file.id, file_name: file.original_name, mime_type: file.mime_type, size: file.size_bytes }
}

function labelOf(mimeType: AllowedMimeType): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF'
    case 'image/png':
      return 'PNG'
    case 'image/jpeg':
      return 'JPEG'
    case 'text/csv':
      return 'CSV'
    default:
      return 'XLSX'
  }
}
