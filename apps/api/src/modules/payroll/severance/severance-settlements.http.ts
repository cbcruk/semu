import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import {
  createSettlement,
  getSettlement,
  listSettlements,
  type SeveranceDeps,
  transitionSettlement,
  updateSettlement,
} from './severance-settlements.ts'

/** `severance-settlements` 그룹 핸들러입니다. */
export const SeveranceSettlementsHttpLive = HttpApiBuilder.group(Api, 'severance-settlements', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<SeveranceDeps>()
    const version = (headers: { readonly 'if-match'?: string }) => expectedVersion(headers['if-match'])
    return handlers
      .handle('list', ({ query }) => listSettlements(query).pipe(Effect.provideContext(context)))
      .handle('create', ({ payload }) =>
        createSettlement(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getSettlement(params.settlementId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updateSettlement(params.settlementId, payload, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('complete', ({ params, headers }) =>
        transitionSettlement(params.settlementId, 'COMPLETE', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('reopen', ({ params, headers }) =>
        transitionSettlement(params.settlementId, 'REOPEN', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('exclude', ({ params, headers }) =>
        transitionSettlement(params.settlementId, 'EXCLUDE', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('include', ({ params, headers }) =>
        transitionSettlement(params.settlementId, 'INCLUDE', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)
