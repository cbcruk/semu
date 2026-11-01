import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { sign } from 'hono/jwt'
import { migrate, openDatabase } from '../src/db/client'
import { SEED, seedDemoData } from '../src/db/seed'
import { loadEnv } from '../src/env'
import { systemClock } from '../src/lib/clock'
import { createAesGcmCipher } from '../src/lib/crypto/aes-gcm-cipher'
import { scheduleFilings } from '../src/jobs/schedule-filings'

const env = loadEnv()
mkdirSync(dirname(env.DATABASE_PATH), { recursive: true })
const db = openDatabase(env.DATABASE_PATH)
migrate(db)
const clock = systemClock()
seedDemoData(db, { now: clock.now(), taxTermsVersion: env.TAX_TERMS_VERSION, cipher: createAesGcmCipher(env.ENCRYPTION_KEY) })
console.log('scheduled filings:', scheduleFilings(db, clock))

const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24
const tokens = {
  admin: await sign({ sub: SEED.users.admin, company_id: SEED.companies.corp, exp }, env.JWT_SECRET, 'HS256'),
  agent: await sign({ sub: SEED.users.agent, exp }, env.JWT_SECRET, 'HS256'),
}
console.log('admin token (company c-corp):', tokens.admin)
console.log('agent token:', tokens.agent)
