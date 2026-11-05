import { Context, Effect, Layer } from 'effect'
import type { BusinessType } from '../../identity-access/actor.types.ts'
import type { VatPeriod } from '../reports/vat-due-date.ts'
import { approximateVatDueDate, vatPeriodContaining } from '../reports/vat-due-date.ts'

/** 홈 경영 현황 카드에 싣는 예상 부가세입니다. */
export interface VatEstimateSummary {
  period: VatPeriod
  estimatedTaxAmount: number
  /** 신고 기한입니다. Tax의 세무 일정이 주말·공휴일을 반영해 정합니다. */
  dueDate: string
}

/**
 * 예상 부가세 포트입니다. 예상 부가세는 Tax가 소유하고(`docs/design/README.md`), Tax는 Bookkeeping의
 * `VatEvidenceQuery`로 증빙을 읽어 계산합니다. 홈 카드만 그 결과를 되읽습니다.
 */
export class VatEstimateSource extends Context.Service<
  VatEstimateSource,
  {
    current(companyId: string, businessType: BusinessType, today: string): Effect.Effect<VatEstimateSummary>
  }
>()('semu/bookkeeping/VatEstimateSource') {
  /** 세액은 `estimatedTaxAmount`로 고정하고 기한은 현행 근사(기간 다음 달 25일)로 정하는 가짜입니다. */
  static readonly layerFake = (estimatedTaxAmount = 0) =>
    Layer.succeed(
      VatEstimateSource,
      VatEstimateSource.of({
        current: (_companyId, businessType, today) =>
          Effect.sync(() => {
            const period = vatPeriodContaining(businessType, today)
            return { period, estimatedTaxAmount, dueDate: approximateVatDueDate(period.end) }
          }),
      }),
    )
}
