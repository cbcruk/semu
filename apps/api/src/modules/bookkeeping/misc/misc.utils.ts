import { createHmac, timingSafeEqual } from 'node:crypto'
import { fromParts, lastDayOfMonth, toParts } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { UploadTokenPayload, YearEndPeriod } from './misc.types'

/**
 * Signs an upload token as `<base64url JSON>.<base64url HMAC-SHA256>`.
 *
 * @example Round trip
 * ```ts
 * import { signUploadToken, verifyUploadToken } from './misc.utils'
 *
 * const token = signUploadToken('secret', { companyId: 'c', userId: 'u', fileId: 'f', fileName: 'a.png', expiresAt: 2_000_000_000 })
 * verifyUploadToken('secret', token, 1_900_000_000)?.fileId // 'f'
 * ```
 */
export function signUploadToken(secret: string, payload: UploadTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${mac(secret, body)}`
}

/**
 * Verifies an upload token's signature and expiry.
 *
 * @param nowSeconds The current time in Unix seconds.
 * @returns The payload, or `null` when the token is forged, malformed or expired.
 */
export function verifyUploadToken(secret: string, token: string, nowSeconds: number): UploadTokenPayload | null {
  const [body, signature] = token.split('.')
  if (body === undefined || signature === undefined) return null
  const expected = Buffer.from(mac(secret, body))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UploadTokenPayload
    return payload.expiresAt > nowSeconds ? payload : null
  } catch {
    return null
  }
}

/** Returns the year-end settlement window (January 15 to the end of February) of the year containing `today`. */
export function yearEndPeriod(today: PlainDate): YearEndPeriod {
  const { year } = toParts(today)
  const start = fromParts(year, 1, 15)
  const end = lastDayOfMonth(year, 2)
  return { is_period: today >= start && today <= end, start, end }
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', `attachment-upload:${secret}`).update(body).digest('base64url')
}
