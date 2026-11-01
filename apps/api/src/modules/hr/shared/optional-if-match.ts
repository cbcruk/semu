import type { Context } from 'hono'
import { DomainError } from '../../../lib/domain-error'

const VERSION_TAG = /^(?:W\/)?"?(\d+)"?$/

/**
 * Reads an `If-Match` version when the client sent one.
 *
 * Some HR endpoints mix field edits with status changes; they accept a
 * missing header for plain edits and call this to enforce it only when the
 * request changes the status.
 *
 * @returns The version, or `null` when the header is absent.
 * @throws {DomainError} `VERSION_CONFLICT` when the header is malformed.
 */
export function readOptionalIfMatch(c: Context): number | null {
  const header = c.req.header('If-Match')
  if (header === undefined) return null
  const match = VERSION_TAG.exec(header.trim())
  if (match === null) throw new DomainError('VERSION_CONFLICT', 'If-Match must carry a version such as "3".')
  return Number(match[1])
}

/** Creates the `PRECONDITION_REQUIRED` error for a status change sent without `If-Match`. */
export function ifMatchRequired(resource: string): DomainError {
  return new DomainError('PRECONDITION_REQUIRED', `Send If-Match with the ${resource} version to change its status.`)
}
