import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openSecret, sealSecret } from './credential-vault.ts'

describe('credential vault', () => {
  const key = randomBytes(32)

  it('round-trips the fields without leaving them readable', () => {
    const sealed = sealSecret(key, { password: 'hometax-1234' })

    expect(JSON.stringify(sealed)).not.toContain('hometax-1234')
    expect(openSecret(key, sealed)).toEqual({ password: 'hometax-1234' })
  })

  it('refuses a tampered value or another key', () => {
    const sealed = sealSecret(key, { password: 'x' })
    const tampered = { ...sealed, ciphertext: Buffer.from('tampered').toString('base64') }

    expect(() => openSecret(key, tampered)).toThrow()
    expect(() => openSecret(randomBytes(32), sealed)).toThrow()
  })
})
