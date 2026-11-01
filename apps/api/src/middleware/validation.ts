import { DomainError } from '../lib/domain-error'

interface ValidationIssue {
  path: readonly PropertyKey[]
  message: string
}

/** Validation result shape passed to `zValidator` hooks. */
export interface ValidationResult {
  success: boolean
  error?: { issues: readonly ValidationIssue[] }
}

/**
 * `zValidator` hook that turns schema failures into a 422 `VALIDATION_FAILED` error with per-field messages.
 *
 * @example Validating a JSON body
 * ```ts
 * import { zValidator } from '@hono/zod-validator'
 * import { z } from 'zod'
 * import { validationHook } from './validation'
 *
 * zValidator('json', z.object({ reason: z.string() }), validationHook)
 * ```
 */
export function validationHook(result: ValidationResult): void {
  if (result.success || result.error === undefined) return
  throw toValidationError(result.error.issues)
}

/** Groups validation issues by dotted field path. */
export function toValidationError(issues: readonly ValidationIssue[]): DomainError {
  const errors: Record<string, string[]> = {}
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || 'non_field_errors'
    ;(errors[field] ??= []).push(issue.message)
  }
  return new DomainError('VALIDATION_FAILED', 'Request validation failed.', { errors })
}
