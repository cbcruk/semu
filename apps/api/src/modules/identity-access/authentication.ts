import { Effect, Layer, Option, Redacted } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api'
import { TokenScopeMismatch, Unauthenticated } from '../../shared/problem/problem.ts'
import { AccessTokens } from './access-tokens.ts'
import { AgentDirectory } from './access/agent-directory.ts'
import { CurrentActor, CurrentAgent } from './actor.ts'

/**
 * `Authorization: Bearer <accessToken>`을 검증하고 {@link CurrentActor}를 넣는 미들웨어입니다.
 *
 * 회사 리소스 그룹은 모두 `.middleware(Authentication)`을 붙입니다. 로그인·가입·서명 링크처럼
 * 인증 전에 부르는 그룹만 붙이지 않습니다. 회사 범위 토큰만 받고, 대리인 범위 토큰이면 403 `TOKEN_SCOPE_MISMATCH`입니다.
 */
export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: CurrentActor }>()(
  'semu/identity-access/Authentication',
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: [Unauthenticated, TokenScopeMismatch],
  },
) {}

/** {@link Authentication} 구현입니다. {@link AccessTokens}가 필요합니다. */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const tokens = yield* AccessTokens
    return Authentication.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const token = Redacted.value(credential)
        const actor = yield* tokens.verify(token)
        if (Option.isSome(actor)) return yield* Effect.provideService(httpEffect, CurrentActor, actor.value)
        if (Option.isSome(yield* tokens.verifyAgency(token))) {
          return yield* new TokenScopeMismatch({ requiredScope: 'COMPANY' })
        }
        return yield* new Unauthenticated({})
      }),
    })
  }),
)

/**
 * 대리인 범위 토큰을 검증하고 {@link CurrentAgent}를 넣는 미들웨어입니다. `/agency/*` 그룹만 붙입니다.
 *
 * 회사 범위 토큰(대리인이 회사에 들어간 토큰 포함)이면 403 `TOKEN_SCOPE_MISMATCH`입니다. 담당 회사는 요청마다 배정에서 계산합니다.
 */
export class AgencyAuthentication extends HttpApiMiddleware.Service<AgencyAuthentication, { provides: CurrentAgent }>()(
  'semu/identity-access/AgencyAuthentication',
  {
    security: { bearer: HttpApiSecurity.bearer },
    error: [Unauthenticated, TokenScopeMismatch],
  },
) {}

/**
 * {@link AgencyAuthentication} 구현입니다. {@link AccessTokens}와, {@link AgentDirectory}가 읽는 사용자·회사·배정 저장소와
 * `CompanyPlans` 포트가 필요합니다.
 */
export const AgencyAuthenticationLive = Layer.effect(
  AgencyAuthentication,
  Effect.gen(function* () {
    const tokens = yield* AccessTokens
    const agents = yield* AgentDirectory
    return AgencyAuthentication.of({
      bearer: Effect.fn(function* (httpEffect, { credential }) {
        const token = Redacted.value(credential)
        const principal = yield* tokens.verifyAgency(token)
        if (Option.isNone(principal)) {
          if (Option.isSome(yield* tokens.verify(token)))
            return yield* new TokenScopeMismatch({ requiredScope: 'AGENCY' })
          return yield* new Unauthenticated({})
        }
        const agent = yield* agents.resolve(principal.value.userId)
        if (Option.isNone(agent)) return yield* new Unauthenticated({})
        return yield* Effect.provideService(httpEffect, CurrentAgent, agent.value)
      }),
    })
  }),
).pipe(Layer.provide(AgentDirectory.layer))
