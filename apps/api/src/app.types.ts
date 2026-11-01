import type { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { Clock } from './lib/clock.types'
import type { Cipher } from './lib/crypto/crypto.types'
import type { FileStorage } from './lib/file-storage/file-storage.types'
import type { AccessContext, UserType } from './modules/access/access.types'
import type { CompanyRow } from './modules/companies/companies.types'
import type { AssistantAdapter } from './modules/platform/adapters/assistant.adapter'
import type { BillingAdapter } from './modules/platform/adapters/billing.adapter'
import type { BusinessStatusAdapter } from './modules/platform/adapters/business-status.adapter'
import type { Messenger } from './modules/platform/adapters/messenger.adapter'
import type { ScrapingAdapter, ScrapResultSink } from './modules/platform/adapters/scraping.adapter'
import type { SocialLoginAdapter } from './modules/platform/adapters/social-login.adapter'
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
  /** Vendor gateway for institution scraping; defaults to a deterministic fake. */
  scraping?: ScrapingAdapter
  /** Receives scraped records for the bookkeeping domain; defaults to a no-op. */
  scrapResultSink?: ScrapResultSink
  /** Sends mail and SMS; defaults to an in-memory outbox. */
  messenger?: Messenger
  /** CMS withdrawal gateway for subscription billing; defaults to a deterministic fake. */
  billing?: BillingAdapter
  /** OAuth code exchange for social login; defaults to a deterministic fake. */
  socialLogin?: SocialLoginAdapter
  /** National Tax Service business status lookup; defaults to a deterministic fake. */
  businessStatus?: BusinessStatusAdapter
  /** LLM backend of the AI assistant; defaults to a deterministic fake. */
  assistant?: AssistantAdapter
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
  /** Session ID when the request authenticated with the session cookie, otherwise `null`. */
  sessionId: string | null
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
