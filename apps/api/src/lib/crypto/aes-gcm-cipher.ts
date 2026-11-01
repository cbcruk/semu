import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { Cipher } from './crypto.types'

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Creates an AES-256-GCM {@linkcode Cipher} from a base64-encoded 32-byte key.
 *
 * Tokens look like `v1.<iv>.<ciphertext+tag>` in base64url, so a future key
 * rotation can add a new version prefix without touching stored rows.
 *
 * @throws {RangeError} When the key does not decode to 32 bytes.
 *
 * @example Round trip
 * ```ts
 * import { createAesGcmCipher } from './aes-gcm-cipher'
 *
 * const cipher = createAesGcmCipher(Buffer.alloc(32, 7).toString('base64'))
 * cipher.decrypt(cipher.encrypt('900101-1234567')) // '900101-1234567'
 * ```
 */
export function createAesGcmCipher(base64Key: string): Cipher {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32) throw new RangeError('The encryption key must decode to 32 bytes.')
  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()])
      return `${VERSION}.${iv.toString('base64url')}.${body.toString('base64url')}`
    },
    decrypt(token) {
      const [version, ivPart, bodyPart] = token.split('.')
      if (version !== VERSION || ivPart === undefined || bodyPart === undefined) throw new Error('Malformed ciphertext.')
      const body = Buffer.from(bodyPart, 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'))
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
      return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString('utf8')
    },
  }
}
