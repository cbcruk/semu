import type { DatabaseSync } from 'node:sqlite'
import type { Clock } from './lib/clock.types'
import type { FileStorage } from './lib/file-storage/file-storage.types'
import type { AccessContext, UserType } from './modules/access/access.types'
import type { CompanyRow } from './modules/companies/companies.types'
import type { TaxType } from './modules/tax-calendar/tax-calendar.types'

/** Dependencies the services need, injected so tests can swap the clock and storage. */
export interface ServiceDeps {
  db: DatabaseSync
  clock: Clock
  storage: FileStorage
}

/** Everything {@linkcode createApp} needs. */
export interface AppDeps extends ServiceDeps {
  /** HS256 secret shared with the nexus JWT issuer. */
  jwtSecret: string
  /** Tax terms version a taxation customer must have agreed to. */
  taxTermsVersion: string
  /** Largest accepted upload body in bytes. */
  maxUploadBytes: number
}

/** The authenticated user, loaded from the JWT subject. */
export interface AuthUser {
  id: string
  userType: UserType
}

/** Request-scoped variables set by middleware. */
export interface AppVariables {
  user: AuthUser
  tokenCompanyId: string | null
  company: CompanyRow
  access: AccessContext
  taxType: TaxType
  expectedVersion: number
}

/** Hono environment shared by every route. */
export interface AppEnv {
  Variables: AppVariables
}
