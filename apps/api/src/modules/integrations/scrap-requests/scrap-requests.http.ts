import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { IdempotencyKeyRequired } from '../../../shared/problem/problem.ts'
import { requirePermission } from '../access.ts'
import { ScrapRequests } from './scrap-requests.ts'

function idempotencyKey(headers: {
  readonly 'idempotency-key'?: string
}): Effect.Effect<string, IdempotencyKeyRequired> {
  const key = headers['idempotency-key']
  return key === undefined || key === '' ? Effect.fail(new IdempotencyKeyRequired({})) : Effect.succeed(key)
}

/** 수집 요청 핸들러입니다. */
export const ScrapRequestsHttpLive = HttpApiBuilder.group(
  Api,
  'scrapRequests',
  Effect.fn(function* (handlers) {
    const scrapRequests = yield* ScrapRequests
    return handlers.handleAll({
      request: ({ headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('scrap-request:create')
          return yield* scrapRequests.request(actor, payload, yield* idempotencyKey(headers))
        }),
      requestAll: ({ headers }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('scrap-request:create')
          return yield* scrapRequests.requestAll(actor, yield* idempotencyKey(headers))
        }),
      availability: () =>
        requirePermission('scrap-request:read').pipe(
          Effect.flatMap(scrapRequests.availability),
          Effect.map((items) => ({ items })),
        ),
      list: ({ query }) =>
        requirePermission('scrap-request:read').pipe(
          Effect.flatMap((actor) => scrapRequests.list(actor, query.institutionType)),
          Effect.map((items) => ({ items })),
        ),
      get: ({ params }) =>
        requirePermission('scrap-request:read').pipe(
          Effect.flatMap((actor) => scrapRequests.get(actor, params.scrapRequestId)),
        ),
    })
  }),
)
