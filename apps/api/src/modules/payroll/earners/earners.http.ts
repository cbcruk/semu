import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { decodeHeaderText } from '../../../shared/personal-data/access-reason.ts'
import {
  createEarner,
  deleteEarner,
  type EarnerDeps,
  getEarner,
  listEarners,
  revealEarnerRegistrationNumber,
  updateEarner,
} from './earners.ts'

/** `earners` 그룹 핸들러입니다. */
export const EarnersHttpLive = HttpApiBuilder.group(Api, 'earners', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<EarnerDeps>()
    return handlers
      .handle('list', ({ query }) => listEarners(query).pipe(Effect.provideContext(context)))
      .handle('create', ({ payload }) =>
        createEarner(payload).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('get', ({ params }) =>
        getEarner(params.earnerId).pipe(Effect.map(withEtag), Effect.provideContext(context)),
      )
      .handle('update', ({ params, payload, headers }) =>
        updateEarner(params.earnerId, payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
      .handle('delete', ({ params }) => deleteEarner(params.earnerId).pipe(Effect.provideContext(context)))
      .handle('revealRegistrationNumber', ({ params, headers }) =>
        revealEarnerRegistrationNumber(params.earnerId, decodeHeaderText(headers['x-access-reason'])).pipe(
          Effect.provideContext(context),
        ),
      )
  }),
)
