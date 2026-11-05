import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { requirePermission } from '../access.ts'
import { Integrations } from './integrations.ts'

/** 기관 연동 핸들러입니다. */
export const IntegrationsResourceHttpLive = HttpApiBuilder.group(
  Api,
  'integrations',
  Effect.fn(function* (handlers) {
    const integrations = yield* Integrations
    return handlers.handleAll({
      list: ({ query }) =>
        requirePermission('integration:read').pipe(Effect.flatMap((actor) => integrations.list(actor, query.type))),
      get: ({ params }) =>
        requirePermission('integration:read').pipe(
          Effect.flatMap((actor) => integrations.get(actor, params.integrationId)),
        ),
      listCandidates: ({ payload }) =>
        requirePermission('integration:create').pipe(
          Effect.flatMap((actor) => integrations.listCandidates(actor, payload)),
          Effect.map((items) => ({ items })),
        ),
      register: ({ payload }) =>
        requirePermission('integration:create').pipe(Effect.flatMap((actor) => integrations.register(actor, payload))),
      replaceCredentials: ({ params, payload }) =>
        requirePermission('integration:update').pipe(
          Effect.flatMap((actor) => integrations.replaceCredentials(actor, params.integrationId, payload)),
        ),
      patchItem: ({ params, payload }) =>
        requirePermission('integration:update').pipe(
          Effect.flatMap((actor) => integrations.patchItem(actor, params.integrationId, params.itemKey, payload)),
        ),
      removeItem: ({ params }) =>
        requirePermission('integration:delete').pipe(
          Effect.flatMap((actor) => integrations.removeItem(actor, params.integrationId, params.itemKey)),
        ),
      remove: ({ params }) =>
        requirePermission('integration:delete').pipe(
          Effect.flatMap((actor) => integrations.remove(actor, params.integrationId)),
        ),
    })
  }),
)
