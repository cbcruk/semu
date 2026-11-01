import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../app.types'
import { DomainError } from '../lib/domain-error'

/** Renders {@linkcode DomainError} as `{ detail, code, ... }` and hides unexpected errors. */
export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof DomainError) {
    return c.json({ detail: error.message, code: error.code, ...error.extras }, error.status)
  }
  if (error instanceof HTTPException) {
    return c.json({ detail: error.message, code: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'HTTP_ERROR' }, error.status)
  }
  console.error(error)
  return c.json({ detail: 'Internal server error.', code: 'INTERNAL_ERROR' }, 500)
}

/** Renders unknown routes in the same error format. */
export const handleNotFound: NotFoundHandler<AppEnv> = (c: Context<AppEnv>) =>
  c.json({ detail: 'Not found.', code: 'NOT_FOUND' }, 404)
