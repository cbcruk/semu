import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { VatEstimates } from './vat-estimates.ts'

/** 추이 기본 연수입니다. */
const DEFAULT_TREND_YEARS = 3

/** 예상 부가세 핸들러입니다. 플랜 없이 열고, 확정 세액 사용 여부만 플랜으로 정합니다. */
export const VatEstimatesHttpLive = HttpApiBuilder.group(
  Api,
  'vatEstimates',
  Effect.fn(function* (handlers) {
    const estimates = yield* VatEstimates

    return handlers.handleAll({
      current: ({ query }) =>
        authorize({ permission: 'estimated-vat:read' }).pipe(
          Effect.flatMap((actor) => estimates.current(actor, query.on)),
        ),
      trend: ({ query }) =>
        authorize({ permission: 'estimated-vat:read' }).pipe(
          Effect.flatMap((actor) => estimates.trend(actor, query.years ?? DEFAULT_TREND_YEARS)),
        ),
    })
  }),
)
