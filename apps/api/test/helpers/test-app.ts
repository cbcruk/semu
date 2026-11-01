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
