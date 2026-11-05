import { Effect } from 'effect'
import { HttpApiBuilder, HttpApiSchema } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { readRefreshCookie, refreshCookie } from './refresh-cookie.ts'
import type { IssuedSession } from './sessions.ts'
import { Sessions } from './sessions.ts'

function withRefreshCookie(issued: IssuedSession) {
  return HttpApiSchema.withHeaders({
    body: issued.grant,
    headers: { 'set-cookie': refreshCookie(issued.refreshToken, issued.refreshMaxAge) },
  })
}

/** 세션 핸들러입니다. */
export const SessionsHttpLive = HttpApiBuilder.group(
  Api,
  'authSessions',
  Effect.fn(function* (handlers) {
    const sessions = yield* Sessions

    return handlers.handleAll({
      signIn: ({ payload }) => sessions.signIn(payload).pipe(Effect.map(withRefreshCookie)),
      signInDemo: () => sessions.signInDemo().pipe(Effect.map(withRefreshCookie)),
      refresh: ({ headers }) => sessions.refresh(readRefreshCookie(headers.cookie)).pipe(Effect.map(withRefreshCookie)),
      switchCompany: ({ headers, payload }) =>
        sessions.refresh(readRefreshCookie(headers.cookie), payload.companyId).pipe(Effect.map(withRefreshCookie)),
      signOut: ({ headers }) =>
        sessions
          .signOut(readRefreshCookie(headers.cookie))
          .pipe(
            Effect.as(HttpApiSchema.withHeaders({ body: undefined, headers: { 'set-cookie': refreshCookie('', 0) } })),
          ),
    })
  }),
)
