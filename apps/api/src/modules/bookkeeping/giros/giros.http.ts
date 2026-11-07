import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { GiroService } from './giro-service.ts'

function versionInput(ifMatch: string | undefined): { expectedVersion?: number } {
  const version = expectedVersion(ifMatch)
  return version === undefined ? {} : { expectedVersion: version }
}

/** 지로 고지서 핸들러입니다. */
export const GirosHttpLive = HttpApiBuilder.group(
  Api,
  'giros',
  Effect.fn(function* (handlers) {
    const giros = yield* GiroService

    return handlers.handleAll({
      list: ({ query }) =>
        Effect.flatMap(requirePermission('giro:read'), (actor) =>
          Effect.map(giros.list(actor.companyId, query), (items) => ({ items })),
        ),
      summary: () => Effect.flatMap(requirePermission('giro:read'), (actor) => giros.summary(actor.companyId)),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('giro:read'), (actor) =>
          giros.get(actor.companyId, params.giroId).pipe(Effect.map(withEtag)),
        ),
      markPaid: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('giro:update'), (actor) =>
          giros
            .apply(actor.companyId, actor.userId, params.giroId, 'MARK_PAID', {
              ...payload,
              ...versionInput(headers['if-match']),
            })
            .pipe(Effect.map(withEtag)),
        ),
      hide: ({ params, headers }) =>
        Effect.flatMap(requirePermission('giro:update'), (actor) =>
          giros
            .apply(actor.companyId, actor.userId, params.giroId, 'HIDE', versionInput(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      pay: ({ params, headers, payload }) =>
        Effect.gen(function* () {
          const actor = yield* requirePermission('giro:pay')
          return withEtag(
            yield* giros.pay(actor.companyId, actor.userId, params.giroId, headers['idempotency-key'], payload),
          )
        }),
    })
  }),
)
