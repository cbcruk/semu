import { appendClearedSessionCookies, appendSessionCookies, parseCookies, SESSION_COOKIE } from '../cookies.ts'
import { camelCase, transformKeys } from '../keys.ts'
import { LegacyError, legacyErrors } from '../legacy-error.ts'
import { etagFrom, json } from '../router.ts'
import type { Route } from '../router.ts'
import { sessionKey } from '../sessions.ts'
import type { BffDeps } from '../upstream.ts'
import { callApi, ensureAccess, readJson, signIn, signOut } from '../upstream.ts'
import type { Company, Me } from '../upstream.types.ts'
import { toLegacyCompany, toLegacyMe, toLegacyMeWithoutCompany, toLegacyProfile } from './identity.mapping.ts'

/**
 * 요청 본문을 JSON 객체로 읽습니다.
 *
 * `Content-Type`이 `application/json`이 아니면 415입니다. HTML 폼은 `text/plain`·`application/x-www-form-urlencoded`로
 * 다른 사이트에서도 사전 요청 없이 보낼 수 있으므로, 그런 본문을 JSON으로 읽지 않습니다.
 */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new LegacyError(415, { detail: 'Send the body as application/json.', code: 'UNSUPPORTED_MEDIA_TYPE' })
  }
  const body: unknown = await request.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw legacyErrors.invalidField('non_field_errors', 'Send a JSON object.')
  }
  return body as Record<string, unknown>
}

/**
 * 로그인 요청이 허용된 출처에서 왔는지 봅니다. 로그인에는 아직 CSRF 토큰이 없어서, 다른 사이트가 피해자 브라우저를
 * 공격자 계정으로 로그인시키는 것(login CSRF)을 출처로 막습니다.
 *
 * `Origin`이 있으면 허용 목록에 있어야 하고, 없으면 `Sec-Fetch-Site: cross-site`를 거절합니다.
 * 둘 다 없는 요청(브라우저가 아닌 도구)은 받습니다. 그런 요청은 피해자의 쿠키를 싣지 못합니다.
 */
function assertLoginOrigin(deps: BffDeps, request: Request): void {
  const origin = request.headers.get('origin')
  if (origin !== null) {
    if (!deps.allowedOrigins.has(origin)) throw crossSiteLogin()
    return
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw crossSiteLogin()
}

function crossSiteLogin(): LegacyError {
  return new LegacyError(403, { detail: 'Sign-in from this origin is not allowed.', code: 'CSRF_FAILED' })
}

/** 다시 로그인할 때 이전 BFF 세션과 그 새 API 세션을 끝냅니다. 실패해도 새 로그인은 막지 않습니다. */
async function endPreviousSession(deps: BffDeps, request: Request): Promise<void> {
  const token = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE)
  if (token === undefined || token === '') return
  const previous = await deps.store.get(sessionKey(token))
  if (previous !== undefined) await signOut(deps, previous)
}

/**
 * 로그인·로그아웃·내 정보·회사 전환·회사 상세입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `POST /api/login/` | `POST /v1/auth/sessions` |
 * | `POST /api/logout/` | `DELETE /v1/auth/sessions/current` |
 * | `GET /api/user/me/` | `GET /v1/me` |
 * | `GET /api/member/profile/` | 마지막 세션 응답의 사용자 |
 * | `POST /api/user/me/jwt/` | `POST /v1/auth/sessions:switch-company` |
 * | `GET /api/company/:companyId/`, `GET /api/settings/company/:companyId/` | (전환 뒤) `GET /v1/companies/current` |
 */
export const identityRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/login',
    auth: false,
    handle: async ({ request, deps }) => {
      assertLoginOrigin(deps, request)
      const body = transformKeys(await readObject(request), camelCase) as Record<string, unknown>
      const { token, session } = await signIn(deps, body)
      await endPreviousSession(deps, request)
      const headers = new Headers()
      appendSessionCookies(headers, {
        token,
        csrfToken: session.csrfToken,
        staySignedIn: session.staySignedIn,
        expiresAt: new Date(session.expiresAt),
      })
      return json(
        {
          user: toLegacyProfile(session.user),
          csrf_token: session.csrfToken,
          expires_at: new Date(session.expiresAt).toISOString(),
        },
        200,
        headers,
      )
    },
  },
  {
    method: 'POST',
    path: '/api/logout',
    auth: true,
    handle: async ({ deps, sessionId }) => {
      const session = await deps.store.get(sessionId)
      if (session !== undefined) await signOut(deps, session)
      const headers = new Headers()
      appendClearedSessionCookies(headers)
      return new Response(null, { status: 204, headers })
    },
  },
  {
    method: 'GET',
    path: '/api/user/me',
    auth: true,
    handle: async ({ deps, sessionId }) => {
      // 회사가 없는 사용자만 저장소에서 바로 답합니다. 나머지는 `callApi`가 필요할 때만 갱신(쓰기 자물쇠)합니다.
      const session = await deps.store.get(sessionId)
      if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
      if (session.companyId === undefined) return json(toLegacyMeWithoutCompany(session.user))
      const me = await readJson<Me>(await callApi(deps, sessionId, undefined, 'GET', '/v1/me'))
      return json(toLegacyMe(me))
    },
  },
  {
    method: 'GET',
    path: '/api/member/profile',
    auth: true,
    handle: async ({ deps, sessionId }) => {
      // 프로필은 마지막 로그인·갱신 응답의 사용자입니다. 새 API를 부르지 않으므로 자물쇠도 필요 없습니다.
      const session = await deps.store.get(sessionId)
      if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
      return json(toLegacyProfile(session.user))
    },
  },
  {
    method: 'POST',
    path: '/api/user/me/jwt',
    auth: true,
    handle: async ({ request, deps, sessionId }) => {
      const body = await readObject(request)
      const companyId = body['company_id']
      if (typeof companyId !== 'string' && typeof companyId !== 'number') {
        throw legacyErrors.invalidField('company_id', 'This field is required.')
      }
      const session = await ensureAccess(deps, sessionId, String(companyId))
      return json({ token: session.accessToken })
    },
  },
  ...['/api/company/:companyId', '/api/settings/company/:companyId'].map((path): Route => ({
    method: 'GET',
    path,
    auth: true,
    handle: async ({ deps, sessionId, params }) => {
      const response = await callApi(deps, sessionId, params['companyId'], 'GET', '/v1/companies/current')
      const company = await readJson<Company>(response)
      const session = await deps.store.get(sessionId)
      return json(toLegacyCompany(company, session?.plans ?? []), 200, etagFrom(response))
    },
  })),
]
