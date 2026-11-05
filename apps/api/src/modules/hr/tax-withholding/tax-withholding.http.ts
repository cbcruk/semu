import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { TaxWithholdingSettings } from './tax-withholding-service.ts'

/** 소득세 공제 설정 핸들러입니다. */
export const TaxWithholdingHttpLive = HttpApiBuilder.group(
  Api,
  'hrTaxWithholding',
  Effect.fn(function* (handlers) {
    const settings = yield* TaxWithholdingSettings
    const today = DateTime.now.pipe(Effect.map((now) => companyDate(DateTime.toEpochMillis(now))))

    return handlers.handleAll({
      get: ({ params, query }) =>
        authorize(hrAccess('employee:read')).pipe(
          Effect.flatMap((actor) =>
            Effect.flatMap(query.asOf === undefined ? today : Effect.succeed(query.asOf), (asOf) =>
              settings.get(actor, params.id, asOf),
            ),
          ),
          Effect.map(withEtag),
        ),
      put: ({ params, headers, payload }) =>
        authorize(hrAccess('employee:update')).pipe(
          Effect.flatMap((actor) => settings.put(actor, params.id, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
    })
  }),
)
