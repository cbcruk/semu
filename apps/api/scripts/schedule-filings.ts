import { migrate, openDatabase } from '../src/db/client'
import { loadEnv } from '../src/env'
import { systemClock } from '../src/lib/clock'
import { scheduleFilings } from '../src/jobs/schedule-filings'

const env = loadEnv()
const db = openDatabase(env.DATABASE_PATH)
migrate(db)
console.log(scheduleFilings(db, systemClock()))
