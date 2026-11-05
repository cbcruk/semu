import { appendClearedSessionCookies, appendSessionCookies } from '../cookies.ts'
import { camelCase, transformKeys } from '../keys.ts'
import { legacyErrors } from '../legacy-error.ts'
import { etagFrom, json } from '../router.ts'
import type { Route } from '../router.ts'
import { callApi, ensureAccess, readJson, signIn, signOut } from '../upstream.ts'
import type { Company, Me } from '../upstream.types.ts'
import { toLegacyCompany, toLegacyMe, toLegacyMeWithoutCompany, toLegacyProfile } from './identity.mapping.ts'

/** 요청 본문을 JSON 객체로 읽습니다. */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw legacyErrors.invalidField('non_field_errors', 'Send a JSON object.')
  }
  return body as Record<string, unknown>
}

/**
 * 로그인·로그아웃·내 정보·회사 전환·회사 상세입니다.
 *
 * | 현행 | 새 API |
 * |---|---|
 * | `POST /api/login/` | `POST /v1/auth/sessions` |
 * | `POST /api/logout/` | `DELETE /v1/auth/sessions/current` |
 * | `GET /api/user/me/` | `GET /v1/me` |
 * | `GET /api/member/profile/` | `GET /v1/me` |
 * | `POST /api/user/me/jwt/` | `POST /v1/auth/sessions:switch-company` |
 * | `GET /api/company/:companyId/`, `GET /api/settings/company/:companyId/` | (전환 뒤) `GET /v1/companies/current` |
 */
export const identityRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/login',
    auth: false,
    handle: async ({ request, deps }) => {
      const body = transformKeys(await readObject(request), camelCase) as Record<string, unknown>
      const { token, session } = await signIn(deps, body)
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
      const session = await ensureAccess(deps, sessionId, undefined)
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
      const session = await ensureAccess(deps, sessionId, undefined)
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
