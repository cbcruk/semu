import { appendClearedSessionCookies, CSRF_COOKIES, CSRF_HEADERS, parseCookies, SESSION_COOKIE } from './cookies.ts'
import { hrRoutes } from './hr/hr.routes.ts'
import { identityRoutes } from './identity/identity.routes.ts'
import { LegacyError, legacyErrors } from './legacy-error.ts'
import { makeRouter } from './router.ts'
import type { Route } from './router.ts'
import { memorySessionStore, SessionLocks, sessionKey } from './sessions.ts'
import type { SessionStore } from './sessions.ts'
import type { BffDeps, UpstreamOptions } from './upstream.ts'

/** BFF가 받는 현행 경로 전체입니다. 화면을 새 API로 옮기면 그 화면의 경로를 여기서 지웁니다. */
export const ROUTES: readonly Route[] = [...identityRoutes, ...hrRoutes]

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** BFF 설정입니다. */
export interface BffOptions {
  upstream: UpstreamOptions
  store?: SessionStore
  now?: () => number
}

/** 현행 와이어를 받는 BFF입니다. 웹 표준 `Request` → `Response` 핸들러 하나입니다. */
export interface Bff {
  handle(request: Request): Promise<Response>
  /** 세션 저장소입니다. 테스트가 세션 상태를 확인할 때 씁니다. */
  readonly store: SessionStore
}

/**
 * BFF를 만듭니다.
 *
 * 요청마다 현행 경로 표에서 라우트를 찾고, 로그인이 필요한 라우트는 `sessionid` 쿠키로 세션을 찾고
 * 쓰기 요청이면 CSRF 토큰(헤더 = 쿠키 = 세션)을 확인합니다. 라우트가 던진 {@link LegacyError}와 예상 밖 오류는
 * 현행 오류 본문 `{ detail, code }`로 응답합니다.
 *
 * @example
 * ```ts
 * const bff = createBff({ upstream: { baseUrl: 'http://localhost:3000', fetch } })
 * const response = await bff.handle(new Request('http://localhost/api/user/me/'))
 * ```
 */
export function createBff(options: BffOptions): Bff {
  const deps: BffDeps = {
    upstream: options.upstream,
    store: options.store ?? memorySessionStore(),
    locks: new SessionLocks(),
    now: options.now ?? Date.now,
  }
  const route = makeRouter(ROUTES)

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const match = route(request.method, url.pathname)
    if (match === undefined) return legacyErrors.notFound().toResponse()
    try {
      if (!match.route.auth) return await match.route.handle({ request, url, params: match.params, deps })
      const sessionId = await authenticate(deps, request)
      return await match.route.handle({ request, url, params: match.params, deps, sessionId })
    } catch (error) {
      const failure = error instanceof LegacyError ? error : legacyErrors.internal()
      if (!(error instanceof LegacyError)) console.error(error)
      const headers = new Headers()
      if (failure.endsSession) appendClearedSessionCookies(headers)
      return failure.toResponse(headers)
    }
  }

  return { handle, store: deps.store }
}

/**
 * 현행 세션 쿠키로 BFF 세션을 찾습니다.
 *
 * @returns 세션 저장 키
 * @throws {LegacyError} 쿠키가 없거나 세션이 끝났으면 401 `UNAUTHENTICATED`, 쓰기 요청의 CSRF 토큰이 다르면 403 `CSRF_FAILED`
 */
async function authenticate(deps: BffDeps, request: Request): Promise<string> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies.get(SESSION_COOKIE)
  if (token === undefined || token === '') throw legacyErrors.unauthenticated()
  const id = sessionKey(token)
  const session = await deps.store.get(id)
  if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
  if (session.expiresAt <= deps.now()) {
    await deps.store.delete(id)
    throw legacyErrors.unauthenticated({ endsSession: true })
  }
  if (!SAFE_METHODS.has(request.method)) {
    const sent = CSRF_HEADERS.map((name) => request.headers.get(name)).find((value) => value !== null)
    const echoed = CSRF_COOKIES.some((name) => cookies.get(name) === sent)
    if (sent === undefined || sent !== session.csrfToken || !echoed) throw legacyErrors.csrfFailed()
  }
  return id
}
