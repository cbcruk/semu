/** Machine-readable error codes returned in the `code` field of error responses. */
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'COMPANY_MISMATCH'
  | 'PERMISSION_DENIED'
  | 'ENTITLEMENT_REQUIRED'
  | 'TAX_TERMS_REQUIRED'
  | 'DEMO_READ_ONLY'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'PRECONDITION_REQUIRED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONFLICT'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'CSRF_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'CERT_NOT_ALLOWED_FOR_SERVICE'

/** Extra fields merged into an error response body. */
export interface ErrorExtras {
  errors?: Record<string, string[]>
  promotion_url?: string | null
  /** Seconds until a rate-limited action may be retried. */
  remain_seconds?: number
  /** Legacy failure string the client matches verbatim, such as `token is expired`. */
  fail_reason?: string
}
