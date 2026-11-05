import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { requirePermission } from '../access.ts'
import { BusinessStatusClient } from '../ports/business-status-client.ts'

/** 사업자 상태조회 핸들러입니다. */
export const BusinessStatusesHttpLive = HttpApiBuilder.group(
  Api,
  'businessStatuses',
  Effect.fn(function* (handlers) {
    const client = yield* BusinessStatusClient
    return handlers.handleAll({
      get: ({ params }) =>
        requirePermission('business-status:read').pipe(
          Effect.flatMap(() => client.lookup(params.businessNumber)),
          Effect.map((result) => ({ businessNumber: params.businessNumber, ...result })),
        ),
    })
  }),
)
