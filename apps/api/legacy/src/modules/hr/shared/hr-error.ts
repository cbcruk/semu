import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../../lib/domain-error'
import type { ErrorExtras } from '../../../lib/domain-error.types'
import type { HrErrorCode } from './hr.types'

const HR_ERROR_STATUS: Record<HrErrorCode, ContentfulStatusCode> = {
  DUPLICATE_EMPLOYEE: 400,
  RETIREMENT_COMPLETED: 400,
  LEAVE_DATE_BEFORE_INTERIM: 400,
  LEAVE_OVERLAP: 400,
  DEPARTMENT_IN_USE: 400,
  POSITION_IN_USE: 400,
  SEAL_LIMIT_EXCEEDED: 400,
  SIGNING_TOKEN_INVALID: 404,
  SIGNING_CLOSED: 410,
  SIGNER_SESSION_REQUIRED: 401,
  SIGNER_SESSION_INVALID: 401,
  IDENTITY_VERIFICATION_FAILED: 403,
  IDENTITY_VERIFICATION_LOCKED: 429,
}

/**
 * A {@linkcode DomainError} carrying an HR-specific code such as `DUPLICATE_EMPLOYEE`.
 *
 * The shared `ErrorCode` union is owned by the platform layer, so this subclass
 * keeps HR codes local and replaces `code` and `status` at runtime. The error
 * handler renders it exactly like any other domain error.
 */
export class HrError extends DomainError {
  /** The HR-specific code, also exposed as `code`. */
  readonly hrCode: HrErrorCode

  /**
   * Creates an HR error.
   *
   * @param extras Fields merged into the response body, such as the current `status` of a closed signing link.
   */
  constructor(code: HrErrorCode, detail: string, extras: ErrorExtras & Record<string, unknown> = {}) {
    super('VALIDATION_FAILED', detail, extras)
    this.name = 'HrError'
    this.hrCode = code
    Object.defineProperty(this, 'code', { value: code, enumerable: true })
  }

  /** HTTP status of {@linkcode HrError.hrCode}. */
  override get status(): ContentfulStatusCode {
    return HR_ERROR_STATUS[this.hrCode]
  }
}
