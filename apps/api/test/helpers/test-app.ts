import type { DatabaseSync } from 'node:sqlite'
import type { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { createApp } from '../../src/app'
import type { AppEnv } from '../../src/app.types'
import { migrate, openDatabase } from '../../src/db/client'
import { SEED, seedDemoData } from '../../src/db/seed'
import { scheduleFilings } from '../../src/jobs/schedule-filings'
import { fixedClock } from '../../src/lib/clock'
import type { Clock } from '../../src/lib/clock.types'
import { createAesGcmCipher } from '../../src/lib/crypto/aes-gcm-cipher'
import type { Cipher } from '../../src/lib/crypto/crypto.types'
import { createMemoryFileStorage } from '../../src/lib/file-storage/memory-file-storage'
import { createFakeNotificationAdapter, type FakeNotificationAdapter } from '../../src/modules/hr/adapters/fake-adapters'
import { createFakeMessenger } from '../../src/modules/platform/adapters/fake-messenger.adapter'
import type { FakeMessenger } from '../../src/modules/platform/adapters/messenger.adapter'
import { PLATFORM_SEED } from '../../src/modules/platform/platform.seed'

export const JWT_SECRET = 'test-secret-test-secret-test-secret'
export const TAX_TERMS_VERSION = '2026-01'
export const NOW = '2026-11-01T09:00:00+09:00'
export const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

export interface RequestOptions {
  json?: unknown
  form?: FormData
  ifMatch?: number | string
}

export interface TestContext {
  app: Hono<AppEnv>
  db: DatabaseSync
  clock: Clock
  storage: ReturnType<typeof createMemoryFileStorage>
  cipher: Cipher
  token(userId: string, companyId?: string): Promise<string>
  call(token: string, method: string, path: string, options?: RequestOptions): Promise<Response>
}

export async function createTestContext(options: { schedule?: boolean; maxUploadBytes?: number } = {}): Promise<TestContext> {
  const db = openDatabase(':memory:')
  migrate(db)
  const clock = fixedClock(NOW)
  const storage = createMemoryFileStorage()
  const cipher = createAesGcmCipher(ENCRYPTION_KEY)
  seedDemoData(db, { now: clock.now(), taxTermsVersion: TAX_TERMS_VERSION, cipher })
  if (options.schedule !== false) scheduleFilings(db, clock)
  const app = createApp({
    db,
    clock,
    storage,
    cipher,
    jwtSecret: JWT_SECRET,
    taxTermsVersion: TAX_TERMS_VERSION,
    maxUploadBytes: options.maxUploadBytes ?? 1024 * 1024,
  })
  return {
    app,
    db,
    clock,
    storage,
    cipher,
    token: (userId, companyId) =>
      sign({ sub: userId, ...(companyId === undefined ? {} : { company_id: companyId }), exp: 4_102_444_800 }, JWT_SECRET, 'HS256'),
    call: (token, method, path, requestOptions = {}) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (requestOptions.ifMatch !== undefined) headers['If-Match'] = `"${requestOptions.ifMatch}"`
      let body: string | FormData | undefined
      if (requestOptions.form !== undefined) body = requestOptions.form
      else if (requestOptions.json !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(requestOptions.json)
      }
      return Promise.resolve(app.request(path, { method, headers, ...(body === undefined ? {} : { body }) }))
    },
  }
}

export function pdfBytes(label: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n% ${label}\n%%EOF`)
}

export function fileForm(bytes: Uint8Array, name: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], name))
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return form
}

export const CORP = SEED.companies.corp
export const USERS = SEED.users

export function grantPayrollPlan(db: DatabaseSync, companyId: string): void {
  db.prepare('UPDATE companies SET has_payroll_plan = 1 WHERE id = ?').run(companyId)
}

export interface HrRequestOptions extends RequestOptions {
  headers?: Record<string, string>
}

export interface HrTestContext extends TestContext {
  notifier: FakeNotificationAdapter
  call(token: string, method: string, path: string, options?: HrRequestOptions): Promise<Response>
  anonymous(method: string, path: string, options?: HrRequestOptions): Promise<Response>
}

export async function createHrTestContext(options: { payrollPlan?: boolean } = {}): Promise<HrTestContext> {
  const base = await createTestContext({ schedule: false })
  if (options.payrollPlan !== false) base.db.prepare('UPDATE companies SET has_payroll_plan = 1 WHERE id = ?').run(CORP)
  const notifier = createFakeNotificationAdapter()
  const app = createApp({
    db: base.db,
    clock: base.clock,
    storage: base.storage,
    cipher: base.cipher,
    jwtSecret: JWT_SECRET,
    taxTermsVersion: TAX_TERMS_VERSION,
    maxUploadBytes: 20 * 1024 * 1024,
    notifier,
  })
  const send = (token: string | null, method: string, path: string, requestOptions: HrRequestOptions = {}): Promise<Response> => {
    const headers: Record<string, string> = { ...requestOptions.headers }
    if (token !== null) headers['Authorization'] = `Bearer ${token}`
    if (requestOptions.ifMatch !== undefined) headers['If-Match'] = `"${requestOptions.ifMatch}"`
    let body: string | FormData | undefined
    if (requestOptions.form !== undefined) body = requestOptions.form
    else if (requestOptions.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(requestOptions.json)
    }
    return Promise.resolve(app.request(path, { method, headers, ...(body === undefined ? {} : { body }) }))
  }
  return {
    ...base,
    app,
    notifier,
    call: (token, method, path, requestOptions) => send(token, method, path, requestOptions),
    anonymous: (method, path, requestOptions) => send(null, method, path, requestOptions),
  }
}

export function pngBytes(label: string): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return new Uint8Array([...signature, ...new TextEncoder().encode(label)])
}

export interface AgentRequestOptions extends RequestOptions {
  csrf?: string | false
  headers?: Record<string, string>
}

export interface SessionAgent {
  cookies: Map<string, string>
  call(method: string, path: string, options?: AgentRequestOptions): Promise<Response>
}

export interface PlatformTestContext extends TestContext {
  messenger: FakeMessenger
  setNow(isoInstant: string): void
  login(email: string, password?: string): Promise<SessionAgent>
  anonymous(): SessionAgent
}

export async function createPlatformTestContext(): Promise<PlatformTestContext> {
  const db = openDatabase(':memory:')
  migrate(db)
  let current = fixedClock(NOW)
  const clock: Clock = { now: () => current.now(), today: () => current.today() }
  const storage = createMemoryFileStorage()
  const cipher = createAesGcmCipher(ENCRYPTION_KEY)
  const messenger = createFakeMessenger()
  seedDemoData(db, { now: clock.now(), taxTermsVersion: TAX_TERMS_VERSION, cipher })
  const app = createApp({ db, clock, storage, cipher, messenger, jwtSecret: JWT_SECRET, taxTermsVersion: TAX_TERMS_VERSION, maxUploadBytes: 1024 * 1024 })
  const send = (method: string, path: string, headers: Record<string, string>, options: RequestOptions): Promise<Response> => {
    let body: string | FormData | undefined
    if (options.form !== undefined) body = options.form
    else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    }
    return Promise.resolve(app.request(path, { method, headers, ...(body === undefined ? {} : { body }) }))
  }
  const agent = (): SessionAgent => {
    const cookies = new Map<string, string>()
    return {
      cookies,
      call: async (method, path, options = {}): Promise<Response> => {
        const headers: Record<string, string> = { ...options.headers }
        if (cookies.size > 0) headers['Cookie'] = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
        const csrf = options.csrf === undefined ? cookies.get('csrftoken') : options.csrf
        if (csrf !== false && csrf !== undefined && method !== 'GET') headers['X-CSRFToken'] = csrf
        const response = await send(method, path, headers, options)
        for (const line of response.headers.getSetCookie()) {
          const [pair = '', ...attributes] = line.split(';')
          const index = pair.indexOf('=')
          const name = pair.slice(0, index).trim()
          const value = pair.slice(index + 1).trim()
          if (value === '' || attributes.some((attribute) => /max-age=0/i.test(attribute.trim()))) cookies.delete(name)
          else cookies.set(name, value)
        }
        return response
      },
    }
  }
  return {
    app,
    db,
    clock,
    storage,
    cipher,
    messenger,
    token: (userId, companyId) =>
      sign({ sub: userId, ...(companyId === undefined ? {} : { company_id: companyId }), exp: 4_102_444_800 }, JWT_SECRET, 'HS256'),
    call: (token, method, path, options = {}) => send(method, path, { Authorization: `Bearer ${token}` }, options),
    setNow: (isoInstant) => {
      current = fixedClock(isoInstant)
    },
    anonymous: agent,
    login: async (email, password = PLATFORM_SEED.password) => {
      const session = agent()
      const response = await session.call('POST', '/api/login', { json: { email, password } })
      if (response.status !== 200) throw new Error(`Login failed with ${response.status}: ${await response.text()}`)
      return session
    },
  }
}
