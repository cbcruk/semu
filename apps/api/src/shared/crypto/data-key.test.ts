import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DataKey,
  dataKeyFingerprint,
  DecryptionFailed,
  decryptString,
  encryptString,
  loadOrCreateKeyFile,
  parseDataKey,
} from './data-key.ts'
import { databaseHasTables, verifyDataKeyFingerprint } from './key-check.ts'

const key = new Uint8Array(randomBytes(32))
const RRN = 'hr/registrationNumber/aes-256-gcm'
const ACCOUNT = 'hr/accountNumber/aes-256-gcm'
const tempDir = () => mkdtempSync(join(tmpdir(), 'semu-key-'))

describe('encryptString / decryptString (AES-256-GCM)', () => {
  it('round-trips with a fresh IV every time', () => {
    const first = encryptString(key, RRN, '900101-1234567')
    const second = encryptString(key, RRN, '900101-1234567')

    expect(first).toMatch(/^v2:[\w-]+:[\w-]+:[\w-]+$/)
    expect(first).not.toEqual(second)
    expect(first).not.toContain('900101')
    expect(decryptString(key, RRN, first)).toBe('900101-1234567')
    expect(decryptString(key, RRN, second)).toBe('900101-1234567')
  })

  it('refuses a tampered ciphertext, tag or IV', () => {
    const token = encryptString(key, ACCOUNT, '110123456789')
    const [version, iv, tag, ciphertext] = token.split(':') as [string, string, string, string]
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url')
      bytes[0] = bytes[0]! ^ 1
      return bytes.toString('base64url')
    }

    expect(() => decryptString(key, ACCOUNT, [version, iv, tag, flip(ciphertext)].join(':'))).toThrow(DecryptionFailed)
    expect(() => decryptString(key, ACCOUNT, [version, iv, flip(tag), ciphertext].join(':'))).toThrow(DecryptionFailed)
    expect(() => decryptString(key, ACCOUNT, [version, flip(iv), tag, ciphertext].join(':'))).toThrow(DecryptionFailed)
    expect(() => decryptString(key, ACCOUNT, [version, iv, tag.slice(0, 8), ciphertext].join(':'))).toThrow(
      DecryptionFailed,
    )
  })

  it('binds the ciphertext to its purpose, so moving it to another field fails', () => {
    const token = encryptString(key, RRN, '900101-1234567')

    expect(() => decryptString(key, ACCOUNT, token)).toThrow(DecryptionFailed)
  })

  it('refuses another key and an unknown format without leaking the plaintext', () => {
    const token = encryptString(key, RRN, 'secret-value')

    expect(() => decryptString(new Uint8Array(randomBytes(32)), RRN, token)).toThrow(DecryptionFailed)
    expect(() => decryptString(key, RRN, token.replace(/^v2:/, 'v1:'))).toThrow(DecryptionFailed)
    expect(() => decryptString(key, RRN, 'enc:c2VjcmV0')).toThrow(DecryptionFailed)
    try {
      decryptString(new Uint8Array(randomBytes(32)), RRN, token)
    } catch (error) {
      expect(String(error)).toContain(RRN)
      expect(String(error)).not.toContain('secret-value')
    }
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

  it('accepts only a strict base64 32-byte key', () => {
    const encoded = Buffer.from(key).toString('base64')

    expect(parseDataKey(encoded)).toEqual(key)
    expect(parseDataKey(`${encoded}\n`)).toEqual(key)
    expect(() => parseDataKey(randomBytes(16).toString('base64'))).toThrow()
    expect(() => parseDataKey(`${encoded.slice(0, 20)}!!!***${encoded.slice(20)}`)).toThrow()
    expect(() => parseDataKey(`${encoded.slice(0, 10)}!${encoded.slice(11)}`)).toThrow()
    expect(() => DataKey.layerFromKey(new Uint8Array(16))).toThrow()
  })
})

describe('key file', () => {
  it('creates the key file with mode 0600 once and reuses it', () => {
    const dir = tempDir()
    const path = join(dir, 'semu.key')

    const created = loadOrCreateKeyFile(path)
    const reused = loadOrCreateKeyFile(path)

    expect(created.created).toBe(true)
    expect(reused.created).toBe(false)
    expect(reused.key).toEqual(created.key)
    expect(parseDataKey(readFileSync(path, 'utf8'))).toEqual(created.key)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['semu.key'])
  })

  it('lets processes that start together agree on one key instead of failing with EEXIST', async () => {
    const path = join(tempDir(), 'semu.key')
    const module = new URL('./data-key.ts', import.meta.url).href
    const script =
      `const { loadOrCreateKeyFile } = await import(${JSON.stringify(module)});` +
      `const { key, created } = loadOrCreateKeyFile(${JSON.stringify(path)});` +
      `process.stdout.write(JSON.stringify({ key: Buffer.from(key).toString('base64'), created }))`
    const run = () =>
      new Promise<{ key: string; created: boolean }>((resolve, reject) =>
        execFile(process.execPath, ['--input-type=module', '-e', script], (error, stdout) =>
          error ? reject(error) : resolve(JSON.parse(stdout) as { key: string; created: boolean }),
        ),
      )

    const results = await Promise.all(Array.from({ length: 6 }, run))

    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(results.map((result) => result.key)).size).toBe(1)
    expect(readdirSync(join(path, '..'))).toEqual(['semu.key'])
  })

  it('refuses a key file readable by group or others', () => {
    const path = join(tempDir(), 'semu.key')
    loadOrCreateKeyFile(path)
    chmodSync(path, 0o644)

    expect(() => loadOrCreateKeyFile(path)).toThrow(/chmod 600/)
  })

  it('does not create a key when asked not to', () => {
    const path = join(tempDir(), 'semu.key')

    expect(() => loadOrCreateKeyFile(path, { create: false })).toThrow(/missing/)
    expect(existsSync(path)).toBe(false)
  })
})

describe('database key fingerprint', () => {
  it('records the fingerprint once and refuses another key afterwards', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    const other = new Uint8Array(randomBytes(32))

    expect(databaseHasTables(filename)).toBe(false)
    expect(verifyDataKeyFingerprint(filename, key)).toBe('RECORDED')
    expect(verifyDataKeyFingerprint(filename, key)).toBe('MATCHED')
    expect(() => verifyDataKeyFingerprint(filename, other)).toThrow(/does not match/)
    expect(databaseHasTables(filename)).toBe(true)
  })

  it('stores a fingerprint that does not reveal the key', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    verifyDataKeyFingerprint(filename, key)

    const db = new DatabaseSync(filename, { readOnly: true })
    const stored = String(db.prepare(`SELECT value FROM semu_meta`).get()?.['value'])
    db.close()
    expect(stored).toBe(dataKeyFingerprint(key))
    expect(stored).not.toContain(Buffer.from(key).toString('hex'))
    expect(stored).not.toContain(Buffer.from(key).toString('base64'))
  })

  it('sees tables in an existing database', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    writeFileSync(filename, '')
    const db = new DatabaseSync(filename)
    db.exec('CREATE TABLE hr_employees (id TEXT PRIMARY KEY)')
    db.close()

    expect(databaseHasTables(filename)).toBe(true)
  })
})
