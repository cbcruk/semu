import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { InsuranceFilings } from './insurance-filings.ts'

/** 4대보험 신고 큐 핸들러입니다. */
export const InsuranceFilingsHttpLive = HttpApiBuilder.group(
  Api,
  'hrInsuranceFilings',
  Effect.fn(function* (handlers) {
    const filings = yield* InsuranceFilings

    return handlers.handleAll({
      list: ({ query }) =>
        authorize(hrAccess('insurance-filing:read')).pipe(
          Effect.flatMap((actor) => filings.list(actor, query)),
          Effect.map((items) => ({ items })),
        ),
      get: ({ params }) =>
        authorize(hrAccess('insurance-filing:read')).pipe(
          Effect.flatMap((actor) => filings.get(actor, params.insuranceFilingId)),
        ),
      complete: ({ params }) =>
        authorize(hrAccess('insurance-filing:process')).pipe(
          Effect.flatMap((actor) => filings.process(actor, params.insuranceFilingId, { type: 'COMPLETE' })),
        ),
      fail: ({ params, payload }) =>
        authorize(hrAccess('insurance-filing:process')).pipe(
          Effect.flatMap((actor) =>
            filings.process(actor, params.insuranceFilingId, { type: 'FAIL', message: payload.message }),
          ),
        ),
    })
  }),
)
