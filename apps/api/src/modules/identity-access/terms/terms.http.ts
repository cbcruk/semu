import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { CurrentActor } from '../actor.ts'
import { Terms } from './terms.ts'

/** 약관 조회 핸들러입니다. */
export const TermsHttpLive = HttpApiBuilder.group(
  Api,
  'terms',
  Effect.fn(function* (handlers) {
    const terms = yield* Terms
    return handlers.handle('list', ({ query }) => terms.current(query.purpose).pipe(Effect.map((items) => ({ items }))))
  }),
)

/** 내 약관 동의 핸들러입니다. 데모 계정도 응답할 수 있도록 권한 검사 없이 행위자만 봅니다. */
export const TermAgreementsHttpLive = HttpApiBuilder.group(
  Api,
  'termAgreements',
  Effect.fn(function* (handlers) {
    const terms = yield* Terms
    return handlers.handleAll({
      list: () => Effect.flatMap(CurrentActor, terms.agreementsOf).pipe(Effect.map((items) => ({ items }))),
      decide: ({ payload }) =>
        Effect.flatMap(CurrentActor, (actor) => terms.decide(actor, payload.decisions)).pipe(
          Effect.map((items) => ({ items })),
        ),
    })
  }),
)
