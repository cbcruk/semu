import { Effect, Layer } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import { VatEstimateSource } from '../modules/bookkeeping/bookkeeping.public.ts'
import { VatEstimateQuery } from '../modules/tax/tax.public.ts'

/**
 * Bookkeeping의 `VatEstimateSource` 포트를 Tax의 예상 부가세 조회(`VatEstimateQuery`)로 구현합니다.
 *
 * 홈 경영 현황 카드가 화면의 `GET /vat-estimates/current`와 같은 세액과, 주말·공휴일을 반영한 납부 기한을 싣습니다.
 */
export const BookkeepingVatEstimateFromTax: Layer.Layer<VatEstimateSource, never, VatEstimateQuery> = Layer.effect(
  VatEstimateSource,
  Effect.gen(function* () {
    const tax = yield* VatEstimateQuery
    return VatEstimateSource.of({
      current: (companyId, businessType, today) =>
        tax.current(companyId as Id<'company'>, businessType, today).pipe(
          Effect.map((estimate) => ({
            period: estimate.period,
            estimatedTaxAmount: estimate.estimatedTax,
            dueDate: estimate.dueDate,
          })),
        ),
    })
  }),
)
