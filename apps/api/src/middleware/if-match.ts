import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.types'
import { DomainError } from '../lib/domain-error'

const VERSION_TAG = /^(?:W\/)?"?(\d+)"?$/

/** Requires an `If-Match: "<version>"` header and stores the version for the handler. */
export function requireIfMatch(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const header = c.req.header('If-Match')
    if (header === undefined) throw new DomainError('PRECONDITION_REQUIRED', 'Send If-Match with the filing version.')
    const match = VERSION_TAG.exec(header.trim())
    if (match === null) throw new DomainError('VERSION_CONFLICT', 'If-Match must carry a filing version such as "3".')
    c.set('expectedVersion', Number(match[1]))
    await next()
  }
}

/** Formats a filing version as an ETag value. */
export function versionTag(version: number): string {
  return `"${version}"`
}
