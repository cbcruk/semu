import { migrate, openDatabase } from '../src/db/client'
import { loadEnv } from '../src/env'
import { runPeriodicJobs } from '../src/jobs/run-periodic-jobs'
import { systemClock } from '../src/lib/clock'
import { createAesGcmCipher } from '../src/lib/crypto/aes-gcm-cipher'
import { createLocalFileStorage } from '../src/lib/file-storage/local-file-storage'

const env = loadEnv()
const db = openDatabase(env.DATABASE_PATH)
migrate(db)
const report = await runPeriodicJobs({
  db,
  clock: systemClock(),
  storage: createLocalFileStorage(env.STORAGE_DIR),
  cipher: createAesGcmCipher(env.ENCRYPTION_KEY),
  jwtSecret: env.JWT_SECRET,
  taxTermsVersion: env.TAX_TERMS_VERSION,
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
})
console.log(report)
