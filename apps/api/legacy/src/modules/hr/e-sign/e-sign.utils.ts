import { createHash, randomBytes } from 'node:crypto'
import { DomainError, invalidField } from '../../../lib/domain-error'
import type { BaseTemplate, ESignRequestStatus, ResolvedTemplate, TemplateBlock, TemplateOverrideRow } from './e-sign.types'

/** Days a worker has to sign after the request is sent (2026.06.23 → 2026.07.09 on the manual screenshot). */
export const ESIGN_DUE_DAYS = 16

/** Minutes a verified signer session stays valid. */
export const SIGNER_SESSION_MINUTES = 30

/** Failed identity checks after which a signing link locks. */
export const MAX_VERIFY_FAILURES = 5

/** Base URL of the worker signing screen used in notification links. */
export const SIGNING_URL_BASE = 'https://app.alfred.kr/e-signature/worker/'

/** Statuses in which a worker's link no longer accepts actions. */
export const CLOSED_STATUSES: readonly ESignRequestStatus[] = ['draft', 'cancelled', 'voided', 'expired', 'send_failed']

/** Creates a random URL-safe secret for signing links and signer sessions. */
export function createSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** Hashes a secret for storage; only the hash is kept so a database leak exposes no live link. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Masks a person's name for unauthenticated screens.
 *
 * @example Three-character name
 * ```ts
 * import { maskName } from './e-sign.utils'
 *
 * maskName('홍길동') // '홍*동'
 * ```
 */
export function maskName(name: string): string {
  const chars = [...name]
  if (chars.length <= 1) return name
  if (chars.length === 2) return `${chars[0]}*`
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars.at(-1)}`
}

/** Merges a base template with a company's override. */
export function mergeTemplate(base: BaseTemplate, override: TemplateOverrideRow | undefined): ResolvedTemplate {
  if (override === undefined) {
    return { ...base, template_type: 'e_sign_template', is_active: true, default_seal_id: null, updated_by: null, updated_at: null }
  }
  const defaults = override.field_defaults === null ? {} : (JSON.parse(override.field_defaults) as Record<string, string | number | null>)
  return {
    ...base,
    title: override.title ?? base.title,
    body: override.body === null ? base.body : (JSON.parse(override.body) as TemplateBlock[]),
    fields: base.fields.map((field) => (Object.hasOwn(defaults, field.key) ? { ...field, default: defaults[field.key] ?? null } : field)),
    template_type: 'company_e_sign_template',
    is_active: override.is_active === 1,
    default_seal_id: override.default_seal_id,
    updated_by: override.updated_by,
    updated_at: override.updated_at,
  }
}

/**
 * Parses the comma-separated status filter.
 *
 * @throws {DomainError} `VALIDATION_FAILED` naming `status` when an entry is unknown.
 */
export function parseRequestStatuses(value: string | undefined): ESignRequestStatus[] {
  if (value === undefined || value.trim() === '') return []
  const known: readonly ESignRequestStatus[] = ['draft', 'pending', 'in_progress', 'completed', 'voided', 'expired', 'cancelled', 'send_failed']
  return value.split(',').map((part) => {
    const status = known.find((candidate) => candidate === part.trim())
    if (status === undefined) throw invalidField('status', `Unknown status: ${part.trim()}`)
    return status
  })
}

/** Reads a string value from a field-value map. */
export function stringValue(values: Record<string, unknown>, key: string): string | null {
  const value = values[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

/** Reads a numeric value from a field-value map, accepting numeric strings. */
export function numberValue(values: Record<string, unknown>, key: string): number | null {
  const value = values[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/,/g, '')))) return Number(value.replace(/,/g, ''))
  return null
}

/** Reads the client's IP from the forwarding header, or `null`. */
export function clientIp(forwardedFor: string | undefined): string | null {
  const first = forwardedFor?.split(',')[0]?.trim()
  return first === undefined || first === '' ? null : first
}

/** Creates the error for a template that is not available to the company. */
export function templateUnavailable(templateId: number): DomainError {
  return invalidField('templates', `Template ${templateId} does not exist or is turned off.`)
}
