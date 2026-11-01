import type { Cipher } from '../lib/crypto/crypto.types'

/** What domain seeders receive besides the database. */
export interface SeedContext {
  /** Seed timestamp in ISO 8601 with offset. */
  now: string
  cipher: Cipher
}
