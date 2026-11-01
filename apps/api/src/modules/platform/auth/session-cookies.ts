import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { IssuedSession } from './auth.types'

/** Cookie that carries the session secret. */
export const SESSION_COOKIE = 'sessionid'

/** CSRF cookies read by the nexus (`nexus_csrftoken`) and sf (`csrftoken`) clients. */
export const CSRF_COOKIES = ['nexus_csrftoken', 'csrftoken'] as const

/** Headers the clients send the CSRF token in. */
export const CSRF_HEADERS = ['X-CSRFToken', 'X-XSRF-TOKEN'] as const

/**
 * Writes the session and CSRF cookies.
 *
 * Sessions without "stay signed in" get browser-session cookies; the server
 * still expires them at `expiresAt`.
 */
export function writeSessionCookies(c: Context, session: IssuedSession): void {
  const persistence = session.staySignedIn ? { expires: new Date(session.expiresAt) } : {}
  setCookie(c, SESSION_COOKIE, session.token, { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', ...persistence })
  for (const name of CSRF_COOKIES) setCookie(c, name, session.csrfToken, { path: '/', secure: true, sameSite: 'Lax', ...persistence })
}

/** Removes the session and CSRF cookies. */
export function clearSessionCookies(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true })
  for (const name of CSRF_COOKIES) deleteCookie(c, name, { path: '/', secure: true })
}
