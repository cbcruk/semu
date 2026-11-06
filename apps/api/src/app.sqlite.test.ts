import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLive, CiphersLive, SqliteLive } from './app.ts'
import { AccountNumberCipher } from './modules/bookkeeping/ports/account-number-cipher.ts'
import { DEMO_PAYROLL_ACCOUNT_NUMBER } from './modules/hr/hr-demo-seed.ts'
import { PersonalDataCipher } from './modules/hr/shared/personal-data-cipher.ts'
import { AccessTokens } from './modules/identity-access/access-tokens.ts'
import { DEMO_PASSWORD, DEMO_USER_IDS } from './modules/identity-access/demo-seed.ts'
import { CredentialVault } from './modules/integrations/credentials/credential-vault.ts'
import { DEMO_SIGN_PASSWORD } from './modules/integrations/demo-seed.ts'
import { DataKey } from './shared/crypto/data-key.ts'

const REGISTRATION_NUMBER = '900101-1234567'

describe('CiphersLive', () => {
  const run = <A>(program: Effect.Effect<A, never, PersonalDataCipher | AccountNumberCipher | CredentialVault>) =>
    Effect.runSync(program.pipe(Effect.provide(CiphersLive.pipe(Layer.provide(DataKey.layerRandom())))))

  it('round-trips personal data and refuses a tampered value', () => {
    const { token, plain, hashes } = run(
      Effect.gen(function* () {
        const cipher = yield* PersonalDataCipher
        const token = yield* cipher.encrypt('registrationNumber', REGISTRATION_NUMBER)
        return {
          token,
          plain: yield* cipher.decrypt('registrationNumber', token),
          hashes: [yield* cipher.hash(REGISTRATION_NUMBER), yield* cipher.hash(REGISTRATION_NUMBER)],
        }
      }),
    )

    expect(token).toMatch(/^v2:/)
    expect(token).not.toContain('900101')
    expect(plain).toBe(REGISTRATION_NUMBER)
    expect(hashes[0]).toBe(hashes[1])
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A')
    expect(() =>
      run(Effect.flatMap(PersonalDataCipher, (cipher) => cipher.decrypt('registrationNumber', tampered))),
    ).toThrow()
  })

  it('round-trips account numbers and refuses a tampered value', () => {
    const { token, plain } = run(
      Effect.map(AccountNumberCipher, (cipher) => {
        const token = cipher.encrypt('partnerAccount', '110123456789')
        return { token, plain: cipher.decrypt('partnerAccount', token) }
      }),
    )

    expect(token).toMatch(/^v2:/)
    expect(token).not.toContain('110123456789')
    expect(plain).toBe('110123456789')
    expect(() =>
      run(
        Effect.map(AccountNumberCipher, (cipher) => cipher.decrypt('partnerAccount', token.replace(/:([^:])/, ':A$1'))),
      ),
    ).toThrow()
  })

  it('binds each account number field, so a ciphertext moved to another field does not open', () => {
    const failures = run(
      Effect.map(AccountNumberCipher, (cipher) => {
        const fields = ['companyAccount', 'partnerAccount', 'giroAccount'] as const
        return fields.flatMap((from) => {
          const token = cipher.encrypt(from, '110123456789')
          return fields
            .filter((to) => to !== from)
            .map((to) => {
              try {
                cipher.decrypt(to, token)
                return `${from}->${to} opened`
              } catch (error) {
                return error instanceof Error ? error.name : 'unknown'
              }
            })
        })
      }),
    )

    expect(failures).toEqual(Array(6).fill('DecryptionFailed'))
  })

  it('seals credentials with a key derived from the data key', () => {
    const opened = run(
      Effect.gen(function* () {
        const vault = yield* CredentialVault
        return yield* vault.open(yield* vault.seal({ password: 'hometax-1234' }))
      }),
    )

    expect(opened).toEqual({ password: 'hometax-1234' })
  })
})

/** `filename`의 SQLite에 서버와 같은 저장소(`SqliteLive`)로 앱을 띄웁니다. */
function sqliteApp(filename: string, key: Uint8Array) {
  const app = HttpRouter.toWebHandler(
    AppLive.pipe(Layer.provide([SqliteLive(filename, key), AccessTokens.layerMemory(), HttpServer.layerServices])),
    { disableLogger: true },
  )
  const request = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { ...options.headers }
    if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const init: RequestInit = { method, headers }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    const response = await app.handler(new Request(`http://localhost${path}`, init))
    const text = await response.text()
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
  }
  const signIn = async (email: string) => {
    const response = await request('POST', '/v1/auth/sessions', { body: { email, password: DEMO_PASSWORD } })
    if (response.status !== 200) throw new Error(`sign-in failed: ${response.status}`)
    return response.body as Record<string, unknown>
  }
  return { request, signIn, dispose: () => app.dispose() }
}

/** 모든 표의 저장된 행(JSON)입니다. */
function storedRows(filename: string): Array<{ table: string; data: string }> {
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()
    return tables.flatMap((row) => {
      const table = String(row['name'])
      const columns = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
      if (!columns.some((column) => column['name'] === 'data')) return []
      return db
        .prepare(`SELECT data FROM ${table}`)
        .all()
        .map((stored) => ({ table, data: String(stored['data']) }))
    })
  } finally {
    db.close()
  }
}

describe('SqliteLive stores personal data and tokens only as ciphertext or hashes', () => {
  const opened: Array<{ dispose(): Promise<void> }> = []
  afterEach(async () => {
    for (const app of opened.splice(0)) await app.dispose()
  })
  const tempDatabase = () => join(mkdtempSync(join(tmpdir(), 'semu-sqlite-')), 'semu.sqlite')

  it('keeps a resident registration number saved over HTTP out of the stored row', async () => {
    const filename = tempDatabase()
    const key = new Uint8Array(randomBytes(32))
    const app = sqliteApp(filename, key)
    opened.push(app)
    const token = String((await app.signIn('owner@semu.example'))['accessToken'])

    const created = await app.request('POST', '/v1/employees', {
      token,
      body: { kind: 'WAGE', name: '홍길동', registrationNumber: REGISTRATION_NUMBER, joinDate: '2024-01-02' },
    })
    expect(created.status).toBe(201)
    await app.dispose()
    opened.length = 0

    const rows = storedRows(filename)
    const employee = rows.find((row) => row.table === 'hr_employees' && row.data.includes(created.body.id))
    expect(employee).toBeDefined()
    expect(JSON.parse(employee!.data).registrationNumberEncrypted).toMatch(/^v2:/)
    for (const plain of [
      REGISTRATION_NUMBER,
      REGISTRATION_NUMBER.replace('-', ''),
      DEMO_PAYROLL_ACCOUNT_NUMBER,
      'hometax-1234',
      'bank-1234',
      DEMO_SIGN_PASSWORD,
    ]) {
      expect(rows.filter((row) => row.data.includes(plain)).map((row) => row.table)).toEqual([])
    }

    const reopened = sqliteApp(filename, key)
    opened.push(reopened)
    const again = String((await reopened.signIn('owner@semu.example'))['accessToken'])
    const revealed = await reopened.request('POST', `/v1/employees/${created.body.id}/registration-number:reveal`, {
      token: again,
      headers: { 'x-access-reason': 'PAYROLL' },
    })
    expect(revealed).toMatchObject({ status: 200, body: { registrationNumber: '9001011234567' } })
  })

  it('logs why decryption failed when the database is opened with another key', async () => {
    const filename = tempDatabase()
    const app = sqliteApp(filename, new Uint8Array(randomBytes(32)))
    opened.push(app)
    const token = String((await app.signIn('owner@semu.example'))['accessToken'])
    const created = await app.request('POST', '/v1/employees', {
      token,
      body: { kind: 'WAGE', name: '홍길동', registrationNumber: REGISTRATION_NUMBER, joinDate: '2024-01-02' },
    })
    await app.dispose()
    opened.length = 0

    const logs: string[] = []
    const capture = (...args: unknown[]) => void logs.push(args.map(String).join(' '))
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(capture),
    )
    const wrongKey = sqliteApp(filename, new Uint8Array(randomBytes(32)))
    opened.push(wrongKey)
    const again = String((await wrongKey.signIn('owner@semu.example'))['accessToken'])
    const revealed = await wrongKey.request('POST', `/v1/employees/${created.body.id}/registration-number:reveal`, {
      token: again,
      headers: { 'x-access-reason': 'PAYROLL' },
    })

    for (const spy of spies) spy.mockRestore()
    expect(revealed).toMatchObject({ status: 500, body: { code: 'INTERNAL' } })
    const logged = logs.join('\n')
    expect(logged).toContain('DecryptionFailed')
    expect(logged).toContain('hr/registrationNumber')
    expect(logged).not.toContain('1234567')
  })

  it('logs a record decode failure without the stored values in its message', async () => {
    const filename = tempDatabase()
    const key = new Uint8Array(randomBytes(32))
    const app = sqliteApp(filename, key)
    opened.push(app)
    await app.signIn('owner@semu.example')
    await app.dispose()
    opened.length = 0

    const db = new DatabaseSync(filename)
    db.prepare(`UPDATE hr_employees SET data = ?`).run('{"name":"홍길동","email":"leak@example.com"')
    db.close()

    const logs: string[] = []
    const capture = (...args: unknown[]) => void logs.push(args.map(String).join(' '))
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(capture),
    )
    const reopened = sqliteApp(filename, key)
    opened.push(reopened)
    const token = String((await reopened.signIn('owner@semu.example'))['accessToken'])
    const listed = await reopened.request('GET', '/v1/employees', { token })

    for (const spy of spies) spy.mockRestore()
    expect(listed).toMatchObject({ status: 500, body: { code: 'INTERNAL' } })
    const logged = logs.join('\n')
    expect(logged).toContain('SyntaxError at src/shared/persistence/json-codec.ts')
    expect(logged).not.toContain('leak@example.com')
    expect(logged).not.toContain('홍길동')
  })

  it('stores access and onboarding tokens only as hashes and expires the onboarding token', async () => {
    const filename = tempDatabase()
    const key = new Uint8Array(randomBytes(32))
    const app = sqliteApp(filename, key)
    opened.push(app)
    const owner = String((await app.signIn('owner@semu.example'))['accessToken'])
    await app.request('DELETE', `/v1/users/${DEMO_USER_IDS.member}`, { token: owner })
    const onboarding = String((await app.signIn('member@semu.example'))['onboardingToken'])
    const other = String((await app.signIn('member@semu.example'))['onboardingToken'])
    expect(other).not.toBe(onboarding)
    await app.dispose()
    opened.length = 0

    const sessions = storedRows(filename).filter((row) => row.table === 'iam_sessions')
    const all = sessions.map((row) => row.data).join('\n')
    expect(all).not.toContain(owner)
    expect(all).not.toContain(onboarding)
    expect(all).toContain(sha256(owner))
    expect(all).toContain(sha256(onboarding))

    const db = new DatabaseSync(filename)
    for (const row of db.prepare(`SELECT id, data FROM iam_sessions`).all()) {
      const record = JSON.parse(String(row['data'])) as Record<string, unknown>
      if (record['onboardingTokenHash'] !== sha256(onboarding)) continue
      expect(Date.parse(String(record['onboardingTokenExpiresAt']))).toBeGreaterThan(Date.now())
      record['onboardingTokenExpiresAt'] = new Date(Date.now() - 1000).toISOString()
      db.prepare(`UPDATE iam_sessions SET data = ? WHERE id = ?`).run(JSON.stringify(record), String(row['id']))
    }
    db.close()

    const reopened = sqliteApp(filename, key)
    opened.push(reopened)
    const registration = { name: '새 회사', businessNumber: '101-86-00006', businessType: 'INDIVIDUAL' }
    const expired = await reopened.request('POST', '/v1/companies', { token: onboarding, body: registration })
    expect(expired.status).toBe(401)

    const registered = await reopened.request('POST', '/v1/companies', { token: other, body: registration })
    expect(registered.status).toBe(201)
  })
})

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
