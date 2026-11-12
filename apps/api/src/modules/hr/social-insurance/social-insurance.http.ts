import { DateTime, Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { SocialInsuranceSettings } from './social-insurance-settings.ts'

/** 4대보험 설정·자격 판정 핸들러입니다. */
export const SocialInsuranceHttpLive = HttpApiBuilder.group(
  Api,
  'hrSocialInsurance',
  Effect.fn(function* (handlers) {
    const settings = yield* SocialInsuranceSettings
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
      determine: ({ params, payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorize(hrAccess('employee:read'))
          const result = yield* settings.determine(actor, params.id, payload, yield* today)
          return {
            ...result,
            recommended: {
              nps: stripUndefined(result.recommended.nps),
              nhis: stripUndefined(result.recommended.nhis),
              ei: stripUndefined(result.recommended.ei),
              iais: stripUndefined(result.recommended.iais),
            },
          }
        }),
    })
  }),
)
