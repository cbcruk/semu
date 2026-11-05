import { Effect, Layer, Option, Redacted } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api'
import { Unauthenticated } from '../../shared/problem/problem.ts'
import { AccessTokens } from './access-tokens.ts'
import { CurrentActor } from './actor.ts'

/**
 * `Authorization: Bearer <accessToken>`을 검증하고 {@link CurrentActor}를 넣는 미들웨어입니다.
 *
 * 회사 리소스 그룹은 모두 `.middleware(Authentication)`을 붙입니다. 로그인·가입·서명 링크처럼
 * 인증 전에 부르는 그룹만 붙이지 않습니다.
 */
export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: CurrentActor }>()(
  'semu/identity-access/Authentication',
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: Unauthenticated,
  },
) {}

/** {@link Authentication} 구현입니다. {@link AccessTokens}가 필요합니다. */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const tokens = yield* AccessTokens
    return Authentication.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const actor = yield* tokens.verify(Redacted.value(credential))
        if (Option.isNone(actor)) return yield* new Unauthenticated({})
        return yield* Effect.provideService(httpEffect, CurrentActor, actor.value)
      }),
    })
  }),
)
