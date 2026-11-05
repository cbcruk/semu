import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { normalizeBusinessNumber } from './business-status-cache.ts'
import { BusinessStatusService, PartnerService } from './partner-service.ts'

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

const BusinessStatusesHttpLive = HttpApiBuilder.group(
  Api,
  'businessStatuses',
  Effect.fn(function* (handlers) {
    const statuses = yield* BusinessStatusService

    return handlers.handleAll({
      get: ({ params }) =>
        Effect.flatMap(requirePermission('business-status:read'), () =>
          statuses.check(normalizeBusinessNumber(params.businessNumber) ?? params.businessNumber),
        ),
    })
  }),
)

/** 거래처·사업자 상태조회 핸들러입니다. */
export const PartnersHttpLive = Layer.mergeAll(PartnerGroupHttpLive, BusinessStatusesHttpLive)
