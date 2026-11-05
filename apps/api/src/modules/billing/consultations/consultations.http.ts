import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { Consultations } from './consultations.ts'

/** 도입 문의 핸들러입니다. */
export const ConsultationsHttpLive = HttpApiBuilder.group(
  Api,
  'consultations',
  Effect.fn(function* (handlers) {
    const consultations = yield* Consultations
    return handlers.handleAll({
      request: ({ payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorize({ permission: 'consultation:create' })
          return yield* consultations.request(actor, payload)
        }),
    })
  }),
)
