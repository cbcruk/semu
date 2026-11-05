import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ErrorCode, ErrorExtras } from './domain-error.types'

/** HTTP status for each {@linkcode ErrorCode}. */
export const ERROR_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  UNAUTHENTICATED: 401,
  COMPANY_MISMATCH: 403,
  PERMISSION_DENIED: 403,
  ENTITLEMENT_REQUIRED: 403,
  TAX_TERMS_REQUIRED: 403,
  DEMO_READ_ONLY: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 412,
  PRECONDITION_REQUIRED: 428,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  CONFLICT: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  INVALID_CREDENTIALS: 401,
  CERT_NOT_ALLOWED_FOR_SERVICE: 422,
}

/** An expected failure that maps to a DRF-style error response. */
export class DomainError extends Error {
  /** Error code sent to the client. */
  readonly code: ErrorCode
  /** Additional response fields such as per-field validation errors. */
  readonly extras: ErrorExtras

  /**
   * Creates an error with a code and a human-readable detail message.
   *
   * @param code The machine-readable code.
   * @param detail The message sent as `detail`.
   * @param extras Fields merged into the response body.
   */
  constructor(code: ErrorCode, detail: string, extras: ErrorExtras = {}) {
    super(detail)
    this.name = 'DomainError'
    this.code = code
    this.extras = extras
  }

  /** HTTP status that corresponds to {@linkcode DomainError.code}. */
  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code]
  }
}

/** Creates a `NOT_FOUND` error for a missing resource. */
export function notFound(resource: string): DomainError {
  return new DomainError('NOT_FOUND', `${resource} not found.`)
}

/** Creates a `VALIDATION_FAILED` error for a single field. */
export function invalidField(field: string, message: string): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed.', { errors: { [field]: [message] } })
}
