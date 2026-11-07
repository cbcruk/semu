import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { BillingMandates } from './billing-mandates.ts'

/** CMS 출금 동의 핸들러입니다. */
export const BillingMandatesHttpLive = HttpApiBuilder.group(
  Api,
  'billingMandates',
  Effect.fn(function* (handlers) {
    const mandates = yield* BillingMandates
    return handlers.handleAll({
      list: () =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'billing-mandate:read' })
          return { items: yield* mandates.list(actor) }
        }),
      register: ({ headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'billing-mandate:create' })
          return yield* mandates.register(actor, payload, headers['idempotency-key'])
        }),
    })
  }),
)
