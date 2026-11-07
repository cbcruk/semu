import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
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
import { databaseHasTables, refuseUnkeyedDatabase, verifyDataKeyFingerprint } from './key-check.ts'

const key = new Uint8Array(randomBytes(32))
const RRN = 'hr/registrationNumber/aes-256-gcm'
const ACCOUNT = 'hr/accountNumber/aes-256-gcm'
const tempDir = () => mkdtempSync(join(tmpdir(), 'semu-key-'))

describe('문자열 암호화·복호화 (AES-256-GCM)', () => {
  it('암호화할 때마다 새 IV를 쓰고, 복호화하면 원문으로 돌아옵니다', () => {
    const first = encryptString(key, RRN, '900101-1234567')
    const second = encryptString(key, RRN, '900101-1234567')

    expect(first).toMatch(/^v2:[\w-]+:[\w-]+:[\w-]+$/)
    expect(first).not.toEqual(second)
    expect(first).not.toContain('900101')
    expect(decryptString(key, RRN, first)).toBe('900101-1234567')
    expect(decryptString(key, RRN, second)).toBe('900101-1234567')
  })

  it('변조된 암호문·인증 태그·IV는 복호화를 거부합니다', () => {
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

  it('암호문을 용도에 묶어 두므로 다른 필드로 옮기면 복호화에 실패합니다', () => {
    const token = encryptString(key, RRN, '900101-1234567')

    expect(() => decryptString(key, ACCOUNT, token)).toThrow(DecryptionFailed)
  })

  it('다른 키와 알 수 없는 형식은 원문을 드러내지 않고 거부합니다', () => {
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

describe('데이터 키', () => {
  const subkeys = (master: Uint8Array) =>
    Effect.runSync(
      Effect.map(DataKey, (dataKey) => ({
        a: Buffer.from(dataKey.subkey('a')).toString('hex'),
        a2: Buffer.from(dataKey.subkey('a')).toString('hex'),
        b: Buffer.from(dataKey.subkey('b')).toString('hex'),
      })).pipe(Effect.provide(DataKey.layerFromKey(master))),
    )

  it('용도마다 서로 다르고 늘 같은 32바이트 하위 키를 파생합니다', () => {
    const derived = subkeys(key)

    expect(derived.a).toHaveLength(64)
    expect(derived.a).toBe(derived.a2)
    expect(derived.a).not.toBe(derived.b)
    expect(derived.a).not.toBe(Buffer.from(key).toString('hex'))
    expect(subkeys(new Uint8Array(randomBytes(32))).a).not.toBe(derived.a)
  })

  it('엄격한 base64로 인코딩한 32바이트 키만 받습니다', () => {
    const encoded = Buffer.from(key).toString('base64')

    expect(parseDataKey(encoded)).toEqual(key)
    expect(parseDataKey(`${encoded}\n`)).toEqual(key)
    expect(() => parseDataKey(randomBytes(16).toString('base64'))).toThrow()
    expect(() => parseDataKey(`${encoded.slice(0, 20)}!!!***${encoded.slice(20)}`)).toThrow()
    expect(() => parseDataKey(`${encoded.slice(0, 10)}!${encoded.slice(11)}`)).toThrow()
    expect(() => DataKey.layerFromKey(new Uint8Array(16))).toThrow()
  })
})

describe('키 파일', () => {
  it('키 파일을 권한 0600으로 한 번만 만들고 이후에는 재사용합니다', () => {
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

  it('함께 시작한 프로세스들이 EEXIST로 실패하지 않고 같은 키 하나를 씁니다', async () => {
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

  it('그룹이나 다른 사용자가 읽을 수 있는 키 파일은 거부합니다', () => {
    const path = join(tempDir(), 'semu.key')
    loadOrCreateKeyFile(path)
    chmodSync(path, 0o644)

    expect(() => loadOrCreateKeyFile(path)).toThrow(/chmod 600/)
  })

  it('만들지 말라고 하면 키 파일을 만들지 않습니다', () => {
    const path = join(tempDir(), 'semu.key')

    expect(() => loadOrCreateKeyFile(path, { create: false })).toThrow(/missing/)
    expect(existsSync(path)).toBe(false)
  })
})

describe('데이터베이스 키 지문', () => {
  it('지문을 한 번 기록하고 이후 다른 키는 거부합니다', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    const other = new Uint8Array(randomBytes(32))

    expect(databaseHasTables(filename)).toBe(false)
    expect(verifyDataKeyFingerprint(filename, key)).toBe('RECORDED')
    expect(verifyDataKeyFingerprint(filename, key)).toBe('MATCHED')
    expect(() => verifyDataKeyFingerprint(filename, other)).toThrow(/does not match/)
    expect(databaseHasTables(filename)).toBe(true)
  })

  it('키를 드러내지 않는 지문을 저장합니다', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    verifyDataKeyFingerprint(filename, key)

    const db = new DatabaseSync(filename, { readOnly: true })
    const stored = String(db.prepare(`SELECT value FROM semu_meta`).get()?.['value'])
    db.close()
    expect(stored).toBe(dataKeyFingerprint(key))
    expect(stored).not.toContain(Buffer.from(key).toString('hex'))
    expect(stored).not.toContain(Buffer.from(key).toString('base64'))
  })

  it('데이터는 있는데 지문이 없는 데이터베이스는 키를 기록하지 않고 거부합니다', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    const db = new DatabaseSync(filename)
    db.exec('CREATE TABLE hr_employees (id TEXT PRIMARY KEY)')
    db.close()

    expect(() => refuseUnkeyedDatabase(filename)).toThrow(/no data key fingerprint.*Delete the database file/)
    expect(() => verifyDataKeyFingerprint(filename, key)).toThrow(/no data key fingerprint/)
    const check = new DatabaseSync(filename, { readOnly: true })
    const meta = check.prepare(`SELECT name FROM sqlite_master WHERE name = 'semu_meta'`).get()
    check.close()
    expect(meta).toBeUndefined()
  })

  it('없거나 빈 데이터베이스와 기록된 키로 연 데이터베이스는 받아들입니다', () => {
    const missing = join(tempDir(), 'semu.sqlite')
    expect(() => refuseUnkeyedDatabase(missing)).not.toThrow()

    const empty = join(tempDir(), 'semu.sqlite')
    writeFileSync(empty, '')
    expect(() => refuseUnkeyedDatabase(empty)).not.toThrow()
    expect(verifyDataKeyFingerprint(empty, key)).toBe('RECORDED')

    const db = new DatabaseSync(empty)
    db.exec('CREATE TABLE hr_employees (id TEXT PRIMARY KEY)')
    db.close()
    expect(() => refuseUnkeyedDatabase(empty)).not.toThrow()
    expect(verifyDataKeyFingerprint(empty, key)).toBe('MATCHED')
  })

  it('기존 데이터베이스에 표가 있으면 알아봅니다', () => {
    const filename = join(tempDir(), 'semu.sqlite')
    writeFileSync(filename, '')
    const db = new DatabaseSync(filename)
    db.exec('CREATE TABLE hr_employees (id TEXT PRIMARY KEY)')
    db.close()

    expect(databaseHasTables(filename)).toBe(true)
  })

  it('시작할 때 다른 서버가 쓰는 중이면 데이터베이스 읽기에 실패하지 않고 기다립니다', async () => {
    const filename = join(tempDir(), 'semu.sqlite')
    verifyDataKeyFingerprint(filename, key)
    // 다른 서버가 배타 잠금을 쥐고 쓰는 중입니다. 읽기 전용 연결도 잠금이 풀릴 때까지 기다려야 합니다.
    const holder = await holdWriteLock(filename, 'EXCLUSIVE', [`INSERT INTO semu_meta (name, value) VALUES ('x', 'y')`])

    const started = Date.now()
    holder.release()
    expect(() => refuseUnkeyedDatabase(filename)).not.toThrow()
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS / 2)
    await holder.done
    expect(databaseHasTables(filename)).toBe(true)
  })

  it('다른 서버가 지문을 기록하는 동안 기다렸다가 그 지문과 비교합니다', async () => {
    const filename = join(tempDir(), 'semu.sqlite')
    const db = new DatabaseSync(filename)
    db.exec(`CREATE TABLE semu_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    db.close()
    // 함께 시작한 다른 서버가 같은 키의 지문을 남기는 중이고 아직 커밋하지 않았습니다. 지문이 없다고 읽은 뒤 따로 기록하면
    // 그 서버가 커밋한 지문과 겹쳐 실패합니다.
    const holder = await holdWriteLock(filename, 'IMMEDIATE', [
      `INSERT INTO semu_meta (name, value) VALUES ('data_key_fingerprint', '${dataKeyFingerprint(key)}')`,
    ])

    const started = Date.now()
    holder.release()
    expect(verifyDataKeyFingerprint(filename, key)).toBe('MATCHED')
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS / 2)
    await holder.done
  })
})

/** {@link holdWriteLock}이 잠금을 쥐고 있는 시간입니다. */
const HOLD_MS = 200

/**
 * 다른 스레드가 `filename`에 `BEGIN <mode>`로 트랜잭션을 열고 `statements`를 실행한 채 잠금을 쥡니다.
 * `release()`를 부르면 {@link HOLD_MS} 뒤에 커밋합니다. 확인하는 함수가 동기라 기다리는 동안 이 스레드가 멈추므로,
 * 바로 앞에서 신호만 보내고 커밋은 그쪽 스레드가 합니다.
 */
async function holdWriteLock(filename: string, mode: 'EXCLUSIVE' | 'IMMEDIATE', statements: ReadonlyArray<string>) {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(
    `const { workerData, parentPort } = require('node:worker_threads');` +
      `const { DatabaseSync } = require('node:sqlite');` +
      `const { filename, mode, statements, signal, holdMs } = workerData;` +
      `const db = new DatabaseSync(filename, { timeout: 5000 });` +
      `db.exec('BEGIN ' + mode);` +
      `for (const sql of statements) db.exec(sql);` +
      `parentPort.postMessage('locked');` +
      `Atomics.wait(signal, 0, 0);` +
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);` +
      `db.exec('COMMIT'); db.close();`,
    { eval: true, workerData: { filename, mode, statements, signal, holdMs: HOLD_MS } },
  )
  const done = new Promise<void>((resolve, reject) => {
    worker.on('error', reject)
    worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`holder exited with ${code}`))))
  })
  await Promise.race([new Promise((resolve) => worker.once('message', resolve)), done])
  return {
    release: () => {
      Atomics.store(signal, 0, 1)
      Atomics.notify(signal, 0)
    },
    done,
  }
}
