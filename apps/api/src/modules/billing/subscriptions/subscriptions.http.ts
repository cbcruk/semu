import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { authorizeAgency } from '../billing-access.ts'
import { Subscriptions } from './subscriptions.ts'

/** 구독 핸들러입니다. */
export const SubscriptionsHttpLive = HttpApiBuilder.group(
  Api,
  'subscriptions',
  Effect.fn(function* (handlers) {
    const subscriptions = yield* Subscriptions
    return handlers.handleAll({
      list: () =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'subscription:read' })
          return { items: yield* subscriptions.list(actor) }
        }),
      get: ({ params }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'subscription:read' })
          return withEtag(yield* subscriptions.get(actor, params.subscriptionId))
        }),
      start: ({ payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorizeAgency('subscription:manage')
          return yield* subscriptions.start(actor, payload)
        }),
      cancel: ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorizeAgency('subscription:manage')
          return withEtag(
            yield* subscriptions.change(actor, params.subscriptionId, 'CANCEL', {
              endsOn: payload.endsOn,
              expectedVersion: expectedVersion(headers['if-match']),
            }),
          )
        }),
      resume: ({ params, headers }) =>
        Effect.gen(function* () {
          const actor = yield* authorizeAgency('subscription:manage')
          return withEtag(
            yield* subscriptions.change(actor, params.subscriptionId, 'RESUME', {
              expectedVersion: expectedVersion(headers['if-match']),
            }),
          )
        }),
    })
  }),
)
