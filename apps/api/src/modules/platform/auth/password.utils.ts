import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { invalidField } from '../../../lib/domain-error'

const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64
const POLICY_MESSAGE = 'Use 8 to 20 characters mixing letters and digits, without spaces.'

/**
 * Hashes a password with scrypt into a self-describing string.
 *
 * The format is `scrypt$N$r$p$salt$hash` with base64url parts, so the cost
 * can be raised later while old hashes keep verifying.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM })
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

/** Checks a password against a hash from {@linkcode hashPassword} in constant time. */
export function verifyPassword(password: string, stored: string | null): boolean {
  if (stored === null) return false
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
  })
  return timingSafeEqual(actual, expected)
}

/** Checks the password policy: 8–20 characters, at least one letter and one digit, no whitespace. */
export function isPasswordAllowed(password: string): boolean {
  return password.length >= 8 && password.length <= 20 && /[A-Za-z]/.test(password) && /\d/.test(password) && !/\s/.test(password)
}

/**
 * Validates a new password and its confirmation.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `password` or `confirm_password`.
 */
export function assertNewPassword(password: string, confirmPassword: string): void {
  if (!isPasswordAllowed(password)) throw invalidField('password', POLICY_MESSAGE)
  if (password !== confirmPassword) throw invalidField('confirm_password', 'The passwords do not match.')
}
