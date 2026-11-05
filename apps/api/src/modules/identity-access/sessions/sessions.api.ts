import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AccountLocked, InvalidCredentials } from '../accounts/user.ts'
import { CompanyNotFound } from '../companies/company.ts'
import { SessionGrant, SessionInvalid, SignInRequest, SwitchCompanyRequest } from './session.ts'

/** refresh 쿠키를 읽는 요청 헤더입니다. */
const cookieHeaders = { cookie: Schema.optionalKey(Schema.String) }

/** 세션 응답과 refresh 쿠키입니다. */
const granted = HttpApiSchema.WithHeaders(SessionGrant, { 'set-cookie': Schema.String })

/**
 * 로그인·토큰 갱신·회사 전환·로그아웃입니다. 인증 전에 부르므로 `Authentication`을 붙이지 않습니다.
 *
 * refresh token은 `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth` 쿠키로만 오가므로 다른 API 요청에는 실리지 않고,
 * access token은 `Authorization` 헤더로만 오가므로 CSRF 토큰이 필요 없습니다.
 */
export class SessionsApi extends HttpApiGroup.make('authSessions')
  .add(
    HttpApiEndpoint.post('signIn', '/sessions', {
      payload: SignInRequest,
      success: granted,
      error: [InvalidCredentials, AccountLocked, CompanyNotFound],
    }),
    HttpApiEndpoint.post('signInDemo', '/sessions::demo', { success: granted }),
    HttpApiEndpoint.post('refresh', '/sessions::refresh', {
      headers: cookieHeaders,
      success: granted,
      error: [SessionInvalid, CompanyNotFound],
    }),
    HttpApiEndpoint.post('switchCompany', '/sessions::switch-company', {
      headers: cookieHeaders,
      payload: SwitchCompanyRequest,
      success: granted,
      error: [SessionInvalid, CompanyNotFound],
    }),
    HttpApiEndpoint.delete('signOut', '/sessions/current', {
      headers: cookieHeaders,
      success: HttpApiSchema.WithHeaders(HttpApiSchema.NoContent, { 'set-cookie': Schema.String }),
    }),
  )
  .prefix('/auth') {}
