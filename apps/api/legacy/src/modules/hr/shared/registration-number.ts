import { createHmac, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { execute, queryOne } from '../../../db/query'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { maskRegistrationNumber, maskTail } from '../../../lib/masking'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'

const HMAC_SECRET_NAME = 'registration_number_hmac'
const RRN_PATTERN = /^\d{6}-?\d{7}$/
const PASSPORT_PATTERN = /^[A-Z0-9]{5,20}$/

const keyCache = new WeakMap<DatabaseSync, Buffer>()

/** How an identification number is written. */
export type IdentificationNumberType = 'registration' | 'passport'

/** A registration number ready to store: ciphertext for reading back, keyed hash for duplicate lookups. */
export interface ProtectedRegistrationNumber {
  encrypted: string
  hash: string
}

/**
 * Normalises a resident, alien registration or passport number for storage and hashing.
 *
 * Registration numbers lose their hyphen; passport numbers are upper-cased.
 *
 * @returns The normalised value, or `null` when it is malformed.
 */
export function normalizeIdentificationNumber(value: string, type: IdentificationNumberType): string | null {
  const trimmed = value.trim()
  if (type === 'passport') {
    const upper = trimmed.toUpperCase()
    return PASSPORT_PATTERN.test(upper) ? upper : null
  }
  if (!RRN_PATTERN.test(trimmed)) return null
  const digits = trimmed.replace('-', '')
  return birthDateFromRegistrationNumber(digits) === null ? null : digits
}

/**
 * Derives the birth date encoded in a resident or alien registration number.
 *
 * The seventh digit gives the century: 1, 2, 5, 6 for the 1900s; 3, 4, 7, 8 for the 2000s; 9, 0 for the 1800s.
 *
 * @returns The birth date, or `null` when the number does not encode a real date.
 */
export function birthDateFromRegistrationNumber(value: string): PlainDate | null {
  const digits = value.replace('-', '')
  if (!/^\d{13}$/.test(digits)) return null
  const centuryDigit = Number(digits[6])
  const century = [1, 2, 5, 6].includes(centuryDigit) ? 1900 : [3, 4, 7, 8].includes(centuryDigit) ? 2000 : 1800
  const date = `${century + Number(digits.slice(0, 2))}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
  return isPlainDate(date) ? toPlainDate(date) : null
}

/**
 * Encrypts a normalised identification number and computes its duplicate-detection hash.
 *
 * The hash is HMAC-SHA256 with a per-database key. The key is 32 random bytes
 * generated on first use and stored in `hr_secrets` encrypted with the same
 * {@linkcode Cipher}, so a database dump alone reveals neither the numbers
 * nor a key to brute-force the 13-digit space against.
 */
export function protectIdentificationNumber(db: DatabaseSync, cipher: Cipher, normalized: string, now: string): ProtectedRegistrationNumber {
  return { encrypted: cipher.encrypt(normalized), hash: hashIdentificationNumber(db, cipher, normalized, now) }
}

/** Computes the keyed hash used to find another employee with the same number. */
export function hashIdentificationNumber(db: DatabaseSync, cipher: Cipher, normalized: string, now: string): string {
  return createHmac('sha256', hmacKey(db, cipher, now)).update(normalized).digest('hex')
}

/** Masks a stored number for responses: `900101-1******` for registration numbers, the last three characters for passports. */
export function maskIdentificationNumber(normalized: string, type: IdentificationNumberType): string {
  return type === 'passport' ? maskTail(normalized, 3) : maskRegistrationNumber(normalized)
}

function hmacKey(db: DatabaseSync, cipher: Cipher, now: string): Buffer {
  const cached = keyCache.get(db)
  if (cached !== undefined) return cached
  const row = queryOne<{ value_enc: string }>(db, 'SELECT value_enc FROM hr_secrets WHERE name = ?', [HMAC_SECRET_NAME])
  let key: Buffer
  if (row === undefined) {
    key = randomBytes(32)
    execute(db, 'INSERT INTO hr_secrets (name, value_enc, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING', [
      HMAC_SECRET_NAME,
      cipher.encrypt(key.toString('base64')),
      now,
    ])
    const stored = queryOne<{ value_enc: string }>(db, 'SELECT value_enc FROM hr_secrets WHERE name = ?', [HMAC_SECRET_NAME])
    if (stored !== undefined) key = Buffer.from(cipher.decrypt(stored.value_enc), 'base64')
  } else {
    key = Buffer.from(cipher.decrypt(row.value_enc), 'base64')
  }
  keyCache.set(db, key)
  return key
}
