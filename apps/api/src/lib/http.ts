import type { Context } from 'hono'
import { DomainError, invalidField } from './domain-error'

/** A file read from a multipart body together with its other fields. */
export interface MultipartUpload {
  upload: { name: string; bytes: Uint8Array }
  fields: Record<string, string>
}

/**
 * Reads the `file` part and the text fields of a multipart request.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the `file` part is missing or empty.
 */
export async function readMultipartUpload(c: Context): Promise<MultipartUpload> {
  const contentType = c.req.header('Content-Type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data.')
  }
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File) || file.size === 0) throw invalidField('file', 'Attach a non-empty file.')
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) if (typeof value === 'string') fields[key] = value
  return { upload: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, fields }
}

/** Sends stored bytes as a download that browsers will not render or sniff. */
export function fileResponse(c: Context, file: { original_name: string; mime_type: string }, data: Uint8Array): Response {
  return c.body(new Uint8Array(data), 200, {
    'Content-Type': file.mime_type,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  })
}
