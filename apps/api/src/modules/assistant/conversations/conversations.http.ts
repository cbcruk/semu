import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { ASSISTANT_ENTRY } from './conversation.ts'
import { Conversations } from './conversations.ts'

const read = { permission: 'conversation:read', requiresTerms: true } as const
const remove = { permission: 'conversation:delete', requiresTerms: true } as const

/** AI 비서 대화 핸들러입니다. */
export const ConversationsHttpLive = HttpApiBuilder.group(
  Api,
  'conversations',
  Effect.fn(function* (handlers) {
    const conversations = yield* Conversations
    return handlers.handleAll({
      listTools: () => authorize(read).pipe(Effect.map((actor) => ({ items: [...conversations.tools(actor)] }))),
      list: ({ query }) => authorize(read).pipe(Effect.flatMap((actor) => conversations.list(actor, query))),
      start: ({ payload }) =>
        authorize(ASSISTANT_ENTRY).pipe(Effect.flatMap((actor) => conversations.start(actor, payload.message))),
      get: ({ params }) =>
        authorize(read).pipe(Effect.flatMap((actor) => conversations.get(actor, params.conversationId))),
      send: ({ params, payload }) =>
        authorize(ASSISTANT_ENTRY).pipe(
          Effect.flatMap((actor) => conversations.send(actor, params.conversationId, payload.message)),
        ),
      remove: ({ params }) =>
        authorize(remove).pipe(Effect.flatMap((actor) => conversations.remove(actor, params.conversationId))),
    })
  }),
)
