import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DomainError } from '../../lib/domain-error'
import type { ErrorExtras } from '../../lib/domain-error.types'

/**
 * Error codes specific to the payroll domain.
 *
 * - `WITHHOLDING_FILED` (409): the withholding return of the card's payment month is filed or settled.
 * - `ADDITIONAL_CARD_NOT_ALLOWED` (409): an additional card breaks one of the manual's rules (spec 1.4).
 * - `WAGE_INCOME_ON_ADDITIONAL_CARD` (409): wage income may only be entered on the month's default card.
 * - `SHIFTEE_RELINK_BLOCKED` (409): Shiftee cannot be linked again after it was unlinked.
 * - `LEAVE_DATE_BEFORE_INTERIM` (400): a retirement date precedes a completed interim settlement.
 */
export type PayrollErrorCode =
  | 'WITHHOLDING_FILED'
  | 'ADDITIONAL_CARD_NOT_ALLOWED'
  | 'WAGE_INCOME_ON_ADDITIONAL_CARD'
  | 'SHIFTEE_RELINK_BLOCKED'
  | 'LEAVE_DATE_BEFORE_INTERIM'

const PAYROLL_ERROR_STATUS: Record<PayrollErrorCode, ContentfulStatusCode> = {
  WITHHOLDING_FILED: 409,
  ADDITIONAL_CARD_NOT_ALLOWED: 409,
  WAGE_INCOME_ON_ADDITIONAL_CARD: 409,
  SHIFTEE_RELINK_BLOCKED: 409,
  LEAVE_DATE_BEFORE_INTERIM: 400,
}

/**
 * A {@linkcode DomainError} carrying a payroll-specific code.
 *
 * The shared `ErrorCode` union belongs to the platform layer, so, like HR's
 * error class, this replaces `code` and `status` at runtime and renders as
 * `{detail, code, ...extras}`.
 */
export class PayrollError extends DomainError {
  /** The payroll-specific code, also exposed as `code`. */
  readonly payrollCode: PayrollErrorCode

  /**
   * Creates a payroll error.
   *
   * @param extras Fields merged into the response body, such as the blocking `reason`.
   */
  constructor(code: PayrollErrorCode, detail: string, extras: ErrorExtras & Record<string, unknown> = {}) {
    super('CONFLICT', detail, extras)
    this.name = 'PayrollError'
    this.payrollCode = code
    Object.defineProperty(this, 'code', { value: code, enumerable: true })
  }

  /** HTTP status of {@linkcode PayrollError.payrollCode}. */
  override get status(): ContentfulStatusCode {
    return PAYROLL_ERROR_STATUS[this.payrollCode]
  }
}
