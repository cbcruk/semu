/**
 * Masks all but the last `visible` characters of a value with `*`.
 *
 * @example Account number
 * ```ts
 * import { maskTail } from './masking'
 *
 * maskTail('110123456789', 4) // '********6789'
 * ```
 */
export function maskTail(value: string, visible: number): string {
  if (value.length <= visible) return value
  return '*'.repeat(value.length - visible) + value.slice(value.length - visible)
}

/**
 * Masks a resident or alien registration number after the gender digit.
 *
 * Accepts the number with or without the hyphen and always returns the
 * hyphenated form, e.g. `900101-1******`.
 */
export function maskRegistrationNumber(value: string): string {
  const digits = value.replace(/-/g, '')
  if (digits.length !== 13) return '*'.repeat(value.length)
  return `${digits.slice(0, 6)}-${digits.slice(6, 7)}******`
}
