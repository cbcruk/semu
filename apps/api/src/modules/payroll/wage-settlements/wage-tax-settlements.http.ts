import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import {
  createWageSettlement,
  deleteWageSettlement,
  getWageSettlement,
  listWageSettlements,
  transitionWageSettlement,
  updateWageSettlement,
  type WageSettlementDeps,
} from './wage-tax-settlements.ts'

/** `wage-tax-settlements` 그룹 핸들러입니다. */
export const WageTaxSettlementsHttpLive = HttpApiBuilder.group(Api, 'wage-tax-settlements', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<WageSettlementDeps>()
    const version = (headers: { readonly 'if-match'?: string }) => expectedVersion(headers['if-match'])
    return handlers
      .handle('list', ({ query }) => listWageSettlements(query).pipe(Effect.provideContext(context)))
      .handle('create', ({ payload }) =>
        createWageSettlement(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getWageSettlement(params.settlementId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updateWageSettlement(params.settlementId, payload, version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('delete', ({ params }) => deleteWageSettlement(params.settlementId).pipe(Effect.provideContext(context)))
      .handle('complete', ({ params, headers }) =>
        transitionWageSettlement(params.settlementId, 'COMPLETE', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('reopen', ({ params, headers }) =>
        transitionWageSettlement(params.settlementId, 'REOPEN', version(headers)).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)
