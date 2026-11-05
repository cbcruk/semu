import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { toSeoulIso } from '../../lib/clock'
import { invalidField } from '../../lib/domain-error'

/** Generates a URL-safe random secret for links, sessions and CSRF tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Hashes a secret so only its digest is stored. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Generates a prefixed opaque identifier such as `inv-…`. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

/** Adds seconds to an ISO 8601 instant and returns it in Korea Standard Time. */
export function addSeconds(isoInstant: string, seconds: number): string {
  return toSeoulIso(new Date(Date.parse(isoInstant) + seconds * 1000))
}

/** Converts an ISO 8601 instant to Unix seconds. */
export function epochSeconds(isoInstant: string): number {
  return Math.floor(Date.parse(isoInstant) / 1000)
}

/** Returns whole seconds from `from` until `to`, never negative. */
export function secondsUntil(from: string, to: string): number {
  return Math.max(0, Math.ceil((Date.parse(to) - Date.parse(from)) / 1000))
}

/** Checks whether instant `a` is strictly before instant `b`. */
export function isBefore(a: string, b: string): boolean {
  return Date.parse(a) < Date.parse(b)
}

/** Normalises an email for comparisons and storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Masks the local part of an email, keeping its first two characters, e.g. `ad***@example.com`. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`
}

/** Parses a JSON column that holds a string array. */
export function parseStringArray(json: string | null): string[] {
  if (json === null) return []
  const value: unknown = JSON.parse(json)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Converts a SQLite 0/1 flag to a boolean. */
export function flag(value: number | null | undefined): boolean {
  return value === 1
}

/**
 * Strips hyphens from a business registration number and validates its check digit.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `business_number` when the number is invalid.
 */
export function requireBusinessNumber(value: string, field = 'business_number'): string {
  const digits = value.replace(/-/g, '')
  if (!isValidBusinessNumber(digits)) throw invalidField(field, 'Enter a valid 10-digit business registration number.')
  return digits
}

/**
 * Checks the National Tax Service check digit of a 10-digit business number.
 *
 * @example
 * ```ts
 * import { isValidBusinessNumber } from './platform.utils'
 *
 * isValidBusinessNumber('1238145600') // true
 * ```
 */
export function isValidBusinessNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const numbers = [...digits].map(Number)
  let sum = 0
  for (let index = 0; index < 9; index += 1) sum += (numbers[index] ?? 0) * (weights[index] ?? 0)
  sum += Math.floor(((numbers[8] ?? 0) * 5) / 10)
  return (10 - (sum % 10)) % 10 === numbers[9]
}

/** Checks the check digit of a 13-digit corporate registration number (법인등록번호). */
export function isValidCorporateNumber(value: string): boolean {
  const digits = value.replace(/-/g, '')
  if (!/^\d{13}$/.test(digits)) return false
  const numbers = [...digits].map(Number)
  let sum = 0
  for (let index = 0; index < 12; index += 1) sum += (numbers[index] ?? 0) * (index % 2 === 0 ? 1 : 2)
  return (10 - (sum % 10)) % 10 === numbers[12]
}
