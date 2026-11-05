import { Effect, Option } from 'effect'
import { HttpApiBuilder, HttpApiSchema } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { TokenScopeMismatch } from '../../../shared/problem/problem.ts'
import { AccessTokens } from '../access-tokens.ts'
import { authorize } from '../authorization.ts'
import { refreshCookie } from '../sessions/refresh-cookie.ts'
import { Invitations } from './invitations.ts'

/** 회사가 보낸 초대 핸들러입니다. */
export const InvitationsHttpLive = HttpApiBuilder.group(
  Api,
  'invitations',
  Effect.fn(function* (handlers) {
    const invitations = yield* Invitations
    return handlers.handleAll({
      list: () =>
        authorize({ permission: 'invitation:read' }).pipe(
          Effect.flatMap(invitations.list),
          Effect.map((items) => ({ items })),
        ),
      create: ({ payload }) =>
        authorize({ permission: 'invitation:create' }).pipe(
          Effect.flatMap((actor) => invitations.create(actor, payload)),
        ),
      cancel: ({ params }) =>
        authorize({ permission: 'invitation:cancel' }).pipe(
          Effect.flatMap((actor) => invitations.cancel(actor, params.invitationId)),
        ),
    })
  }),
)

/**
 * 초대 링크 핸들러입니다. 유효한 회사 범위 access token이 오면 그 사용자로 수락합니다.
 *
 * 대리인 범위 토큰은 무시하지 않고 403 `TOKEN_SCOPE_MISMATCH`로 거절합니다. 다른 회사 경로와 같은 규칙입니다.
 */
export const InvitationLinksHttpLive = HttpApiBuilder.group(
  Api,
  'invitationLinks',
  Effect.fn(function* (handlers) {
    const invitations = yield* Invitations
    const tokens = yield* AccessTokens
    return handlers.handleAll({
      preview: ({ payload }) => invitations.preview(payload.token),
      accept: Effect.fn(function* ({ headers, payload }) {
        const bearer = headers.authorization?.match(/^Bearer (.+)$/i)?.[1]
        const actor = bearer === undefined ? Option.none() : yield* tokens.verify(bearer)
        if (bearer !== undefined && Option.isNone(actor) && Option.isSome(yield* tokens.verifyAgency(bearer))) {
          return yield* new TokenScopeMismatch({ requiredScope: 'COMPANY' })
        }
        const issued = yield* invitations.accept(
          payload,
          Option.match(actor, { onNone: () => undefined, onSome: (a) => a.userId }),
        )
        return HttpApiSchema.withHeaders({
          body: issued.grant,
          headers: { 'set-cookie': refreshCookie(issued.refreshToken, issued.refreshMaxAge) },
        })
      }),
    })
  }),
)
