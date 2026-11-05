import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { ActionCards } from './action-cards.ts'

/** 할 일 카드 핸들러입니다. 플랜은 카드마다 보므로 엔드포인트에서는 권한만 봅니다. */
export const ActionCardsHttpLive = HttpApiBuilder.group(
  Api,
  'actionCards',
  Effect.fn(function* (handlers) {
    const cards = yield* ActionCards

    return handlers.handleAll({
      list: ({ query }) =>
        authorize({ permission: 'action-card:read' }).pipe(
          Effect.flatMap((actor) => {
            const { status, ...page } = query
            return cards.list(actor, status ?? 'OPEN', page)
          }),
        ),
      summary: () =>
        authorize({ permission: 'action-card:read' }).pipe(Effect.flatMap((actor) => cards.summary(actor))),
      complete: ({ params, payload }) =>
        authorize({ permission: 'action-card:complete' }).pipe(
          Effect.flatMap((actor) => cards.complete(actor, params.cardId, payload.completion)),
        ),
    })
  }),
)
