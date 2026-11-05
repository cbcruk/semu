import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { authorizeAgency, requireIdempotencyKey } from '../billing-access.ts'
import { Payments } from './payments.ts'

/** 결제 핸들러입니다. */
export const PaymentsHttpLive = HttpApiBuilder.group(
  Api,
  'payments',
  Effect.fn(function* (handlers) {
    const payments = yield* Payments
    return handlers.handleAll({
      list: ({ query }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'payment:read' })
          return yield* payments.list(actor, query)
        }),
      get: ({ params }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'payment:read' })
          return withEtag(yield* payments.get(actor, params.paymentId))
        }),
      retry: ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorizeAgency('payment:retry')
          yield* requireIdempotencyKey(headers['idempotency-key'])
          return withEtag(
            yield* payments.retry(actor, params.paymentId, {
              ...payload,
              expectedVersion: expectedVersion(headers['if-match']),
            }),
          )
        }),
      refund: ({ params, headers }) =>
        Effect.gen(function* () {
          const actor = yield* authorizeAgency('payment:refund')
          yield* requireIdempotencyKey(headers['idempotency-key'])
          return withEtag(
            yield* payments.refund(actor, params.paymentId, { expectedVersion: expectedVersion(headers['if-match']) }),
          )
        }),
    })
  }),
)
