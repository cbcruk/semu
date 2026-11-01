import type { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { Clock } from './lib/clock.types'
import type { Cipher } from './lib/crypto/crypto.types'
import type { FileStorage } from './lib/file-storage/file-storage.types'
import type { AccessContext, UserType } from './modules/access/access.types'
import type { CompanyRow } from './modules/companies/companies.types'
import type { TaxType } from './modules/tax-calendar/tax-calendar.types'

/** Dependencies the services need, injected so tests can swap the clock and storage. */
export interface ServiceDeps {
  db: DatabaseSync
  clock: Clock
  storage: FileStorage
  /** Encrypts personal and credential data at rest. */
  cipher: Cipher
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

/**
 * Routers a domain contributes to {@linkcode createApp}.
 *
 * - `public`: mounted at the root before authentication (login, signup, worker e-sign links).
 * - `account`: mounted at the root after authentication, outside any company (`/api/user/me`).
 * - `company`: mounted under `/api/company/:companyId` after the company scope check.
 *
 * Each router declares full paths relative to its mount point and must not
 * register catch-all middleware, because sibling domains share the mount.
 */
export interface DomainRoutes {
  public?: Hono<AppEnv>
  account?: Hono<AppEnv>
  company?: Hono<AppEnv>
}
