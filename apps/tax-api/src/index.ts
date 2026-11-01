import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { migrate, openDatabase } from './db/client'
import { loadEnv } from './env'
import { systemClock } from './lib/clock'
import { createLocalFileStorage } from './lib/file-storage/local-file-storage'

const env = loadEnv()
mkdirSync(dirname(env.DATABASE_PATH), { recursive: true })
const db = openDatabase(env.DATABASE_PATH)
migrate(db)

const app = createApp({
  db,
  clock: systemClock(),
  storage: createLocalFileStorage(env.STORAGE_DIR),
  jwtSecret: env.JWT_SECRET,
  taxTermsVersion: env.TAX_TERMS_VERSION,
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`tax-api listening on http://localhost:${info.port}`)
})
