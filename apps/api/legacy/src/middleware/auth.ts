import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import type { AppDeps, AppEnv } from '../app.types'
import { queryOne } from '../db/query'
import { DomainError } from '../lib/domain-error'
import type { UserType } from '../modules/access/access.types'
import type { ResolvedCredentials } from '../modules/platform/auth/auth.types'
import { CSRF_COOKIES, CSRF_HEADERS, SESSION_COOKIE } from '../modules/platform/auth/session-cookies'
import { findActiveSession } from '../modules/platform/auth/sessions.repository'
import { sha256Hex } from '../modules/platform/platform.utils'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const PATH_COMPANY = /\/company\/([^/]+)/

type AuthDeps = Pick<AppDeps, 'db' | 'jwtSecret' | 'clock'>

/**
 * Authenticates a request with either a company JWT or a session cookie.
 *
 * - `Authorization: Bearer <JWT>`: HS256, `sub` is the user ID and the
 *   optional `company_id` binds the token to one company. `exp` is checked
 *   against the injected clock.
 * - Session cookie `sessionid`: unsafe methods must echo the CSRF cookie in
 *   `X-CSRFToken`. Session requests carry no company claim, so the company in
 *   the path stands in for it and the company scope decides by membership.
 */
export function authenticate(deps: AuthDeps): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const credentials = await resolveCredentials(deps, c)
    if (credentials === null) throw unauthenticated()
    c.set('user', credentials.user)
    c.set('tokenCompanyId', credentials.tokenCompanyId)
    c.set('sessionId', credentials.sessionId)
    await next()
  }
}

/**
 * Reads the request's credentials without requiring them, for public routes that behave differently when signed in.
 *
 * @returns The credentials, or `null` when the request carries none.
 * @throws {DomainError} `UNAUTHENTICATED` for an invalid bearer token or
 * `CSRF_FAILED` for a session write without a matching CSRF header.
 */
export async function resolveCredentials(deps: AuthDeps, c: Context): Promise<ResolvedCredentials | null> {
  const header = c.req.header('Authorization')
  if (header !== undefined && header.startsWith('Bearer ')) return fromBearer(deps, header.slice('Bearer '.length))
  const sessionToken = getCookie(c, SESSION_COOKIE)
  if (sessionToken === undefined) return null
  const session = findActiveSession(deps.db, sha256Hex(sessionToken), deps.clock.now())
  if (session === undefined) return null
  if (!SAFE_METHODS.has(c.req.method)) {
    const sent = CSRF_HEADERS.map((name) => c.req.header(name)).find((value) => value !== undefined)
    const cookies = CSRF_COOKIES.map((name) => getCookie(c, name)).filter((value) => value !== undefined)
    if (sent === undefined || sent !== session.csrf_token || !cookies.includes(sent)) {
      throw new DomainError('CSRF_FAILED', 'CSRF token missing or incorrect.')
    }
  }
  const user = findActiveUser(deps, session.user_id)
  if (user === null) return null
  return { user, tokenCompanyId: PATH_COMPANY.exec(c.req.path)?.[1] ?? null, sessionId: session.id }
}

async function fromBearer(deps: AuthDeps, token: string): Promise<ResolvedCredentials> {
  let payload: Record<string, unknown>
  try {
    payload = await verify(token, deps.jwtSecret, { alg: 'HS256', exp: false, nbf: false, iat: false })
  } catch {
    throw unauthenticated()
  }
  const expiry = payload['exp']
  if (typeof expiry === 'number' && expiry * 1000 <= Date.parse(deps.clock.now())) throw unauthenticated()
  const subject = payload['sub']
  if (typeof subject !== 'string') throw unauthenticated()
  const user = findActiveUser(deps, subject)
  if (user === null) throw unauthenticated()
  const companyId = payload['company_id']
  return {
    user,
    tokenCompanyId: typeof companyId === 'string' || typeof companyId === 'number' ? String(companyId) : null,
    sessionId: null,
  }
}

function findActiveUser(deps: AuthDeps, userId: string): ResolvedCredentials['user'] | null {
  const user = queryOne<{ id: string; user_type: UserType }>(deps.db, 'SELECT id, user_type FROM users WHERE id = ? AND is_active = 1', [userId])
  return user === undefined ? null : { id: user.id, userType: user.user_type }
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'Authentication credentials were not provided or are invalid.')
}
