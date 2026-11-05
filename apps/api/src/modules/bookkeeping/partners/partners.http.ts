import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { PartnerService } from './partner-service.ts'

const PartnerGroupHttpLive = HttpApiBuilder.group(
  Api,
  'partners',
  Effect.fn(function* (handlers) {
    const partners = yield* PartnerService

    return handlers.handleAll({
      list: ({ query: { limit, cursor, ...filter } }) =>
        Effect.flatMap(requirePermission('partner:read'), (actor) =>
          partners.list(actor.companyId, filter, {
            ...(limit === undefined ? {} : { limit }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      create: ({ payload }) =>
        Effect.flatMap(requirePermission('partner:create'), (actor) => partners.create(actor.companyId, payload)),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('partner:read'), (actor) =>
          partners.get(actor.companyId, params.partnerId).pipe(Effect.map(withEtag)),
        ),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('partner:update'), (actor) =>
          partners
            .update(actor.companyId, params.partnerId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      remove: ({ params }) =>
        Effect.flatMap(requirePermission('partner:delete'), (actor) =>
          partners.remove(actor.companyId, params.partnerId),
        ),
    })
  }),
)

/** 거래처 핸들러입니다. 사업자 상태조회 경로는 Integrations가 소유합니다. */
export const PartnersHttpLive = PartnerGroupHttpLive
