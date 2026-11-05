import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { DataKey, decryptString, encryptString, loadOrCreateKeyFile, parseDataKey } from './data-key.ts'

const key = new Uint8Array(randomBytes(32))

describe('encryptString / decryptString (AES-256-GCM)', () => {
  it('round-trips with a fresh IV every time', () => {
    const first = encryptString(key, '900101-1234567')
    const second = encryptString(key, '900101-1234567')

    expect(first).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/)
    expect(first).not.toEqual(second)
    expect(first).not.toContain('900101')
    expect(decryptString(key, first)).toBe('900101-1234567')
    expect(decryptString(key, second)).toBe('900101-1234567')
  })

  it('refuses a tampered ciphertext, tag or IV', () => {
    const token = encryptString(key, '110123456789')
    const [version, iv, tag, ciphertext] = token.split(':') as [string, string, string, string]
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url')
      bytes[0] = bytes[0]! ^ 1
      return bytes.toString('base64url')
    }

    expect(() => decryptString(key, [version, iv, tag, flip(ciphertext)].join(':'))).toThrow()
    expect(() => decryptString(key, [version, iv, flip(tag), ciphertext].join(':'))).toThrow()
    expect(() => decryptString(key, [version, flip(iv), tag, ciphertext].join(':'))).toThrow()
    expect(() => decryptString(key, [version, iv, tag.slice(0, 8), ciphertext].join(':'))).toThrow()
  })

  it('refuses another key and an unknown format', () => {
    const token = encryptString(key, 'secret')

    expect(() => decryptString(new Uint8Array(randomBytes(32)), token)).toThrow()
    expect(() => decryptString(key, token.replace(/^v1:/, 'v9:'))).toThrow()
    expect(() => decryptString(key, 'enc:c2VjcmV0')).toThrow()
  })
})

describe('DataKey', () => {
  const subkeys = (master: Uint8Array) =>
    Effect.runSync(
      Effect.map(DataKey, (dataKey) => ({
        a: Buffer.from(dataKey.subkey('a')).toString('hex'),
        a2: Buffer.from(dataKey.subkey('a')).toString('hex'),
        b: Buffer.from(dataKey.subkey('b')).toString('hex'),
      })).pipe(Effect.provide(DataKey.layerFromKey(master))),
    )

  it('derives a stable, separate 32-byte subkey per purpose', () => {
    const derived = subkeys(key)

    expect(derived.a).toHaveLength(64)
    expect(derived.a).toBe(derived.a2)
    expect(derived.a).not.toBe(derived.b)
    expect(derived.a).not.toBe(Buffer.from(key).toString('hex'))
    expect(subkeys(new Uint8Array(randomBytes(32))).a).not.toBe(derived.a)
  })

  it('accepts only a base64 32-byte key', () => {
    expect(parseDataKey(Buffer.from(key).toString('base64'))).toEqual(key)
    expect(() => parseDataKey(randomBytes(16).toString('base64'))).toThrow()
    expect(() => DataKey.layerFromKey(new Uint8Array(16))).toThrow()
  })

  it('creates the key file with mode 0600 once and reuses it', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'semu-key-')), 'semu.key')

    const created = loadOrCreateKeyFile(path)
    const reused = loadOrCreateKeyFile(path)

    expect(created.created).toBe(true)
    expect(reused.created).toBe(false)
    expect(reused.key).toEqual(created.key)
    expect(parseDataKey(readFileSync(path, 'utf8'))).toEqual(created.key)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
