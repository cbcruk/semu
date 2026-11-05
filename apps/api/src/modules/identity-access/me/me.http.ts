import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { CurrentActor } from '../actor.ts'
import { MeService } from './me.ts'

/** 내 정보 핸들러입니다. */
export const MeHttpLive = HttpApiBuilder.group(
  Api,
  'me',
  Effect.fn(function* (handlers) {
    const me = yield* MeService
    return handlers.handleAll({
      get: () => Effect.flatMap(CurrentActor, me.profile),
      changePassword: ({ payload }) => Effect.flatMap(CurrentActor, (actor) => me.changePassword(actor, payload)),
    })
  }),
)
