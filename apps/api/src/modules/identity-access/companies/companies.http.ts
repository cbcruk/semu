import { Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { Unauthenticated } from '../../../shared/problem/problem.ts'
import { AccessTokens } from '../access-tokens.ts'
import { authorize } from '../authorization.ts'
import { Sessions } from '../sessions/sessions.ts'
import { Companies } from './companies.ts'

/** 지금 회사 핸들러입니다. */
export const CurrentCompanyHttpLive = HttpApiBuilder.group(
  Api,
  'currentCompany',
  Effect.fn(function* (handlers) {
    const companies = yield* Companies
    return handlers.handleAll({
      get: () =>
        authorize({ permission: 'company:read' }).pipe(Effect.flatMap(companies.current), Effect.map(withEtag)),
      update: ({ headers, payload }) =>
        authorize({ permission: 'company:update' }).pipe(
          Effect.flatMap((actor) => companies.update(actor, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
    })
  }),
)

/**
 * 회사 등록 핸들러입니다. access token이면 그 사용자, 아니면 onboarding token의 사용자로 등록합니다.
 *
 * onboarding token은 등록에 성공하면 지웁니다. 같은 토큰으로 회사를 여러 개 등록하지 못합니다. 등록이 실패(409·422)하면 남깁니다.
 */
export const CompanyRegistrationsHttpLive = HttpApiBuilder.group(
  Api,
  'companyRegistrations',
  Effect.fn(function* (handlers) {
    const companies = yield* Companies
    const tokens = yield* AccessTokens
    const sessions = yield* Sessions
    const userOf = Effect.fn(function* (authorization: string | undefined) {
      const token = authorization?.match(/^Bearer (.+)$/i)?.[1]
      if (token === undefined) return yield* new Unauthenticated({})
      const actor = yield* tokens.verify(token)
      if (Option.isSome(actor)) return { userId: actor.value.userId, onboardingToken: undefined }
      const onboarding = yield* sessions.onboardingUser(token)
      if (Option.isSome(onboarding)) return { userId: onboarding.value, onboardingToken: token }
      return yield* new Unauthenticated({})
    })
    return handlers.handleAll({
      register: ({ headers, payload }) =>
        Effect.gen(function* () {
          const { userId, onboardingToken } = yield* userOf(headers.authorization)
          const registered = yield* companies.register(userId, payload)
          if (onboardingToken !== undefined) yield* sessions.consumeOnboardingToken(onboardingToken)
          return registered
        }),
    })
  }),
)
