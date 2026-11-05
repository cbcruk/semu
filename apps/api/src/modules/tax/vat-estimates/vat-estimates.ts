import { Context, Effect, Layer, Option, Schema } from 'effect'
import type { Actor } from '../../identity-access/actor.types.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { TaxProfiles } from '../calendar/tax-profiles.ts'
import { currentInstant } from '../tax-time.ts'
import { estimateVat, FULL_RATIO_PPM, vatEstimatePeriod, vatHalfPeriod, vatTrend } from './vat-estimate.ts'
import type { VatEstimate, VatTrendPoint } from './vat-estimate.types.ts'
import { VatEvidence } from './vat-evidence.ts'

const SalesOrPurchaseSource = Schema.Literals(['TAX_INVOICE', 'CASH_RECEIPT', 'CARD', 'PG', 'MALL', 'DELIVERY'])

/** 예상 부가세 응답입니다. `estimatedTax`가 음수면 환급 예상입니다. */
export const VatEstimateResponse = Schema.Struct({
  period: Schema.Struct({
    start: Schema.String,
    end: Schema.String,
    unit: Schema.Literals(['QUARTER', 'HALF']),
  }),
  /** 계산에 쓴 증빙의 마지막 날입니다. 진행 중인 기간이면 오늘(또는 `on`)입니다. */
  asOf: Schema.String,
  outputTax: Schema.Int,
  inputTax: Schema.Int,
  estimatedTax: Schema.Int,
  cardSplitEstimated: Schema.Boolean,
  breakdown: Schema.Array(
    Schema.Struct({
      side: Schema.Literals(['SALES', 'PURCHASE']),
      source: SalesOrPurchaseSource,
      vatAmount: Schema.Int,
      includedInTotal: Schema.Boolean,
      lastSyncedAt: Schema.NullOr(Schema.String),
    }),
  ),
  excluded: Schema.Struct({ nonDeductibleCount: Schema.Int, unclassifiedCount: Schema.Int }),
})

export type VatEstimateResponse = typeof VatEstimateResponse.Type

/** 부가세 추이 응답입니다. 과세기간(반기)마다 한 점입니다. */
export const VatTrendResponse = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      year: Schema.Int,
      half: Schema.Literals([1, 2]),
      amount: Schema.Int,
      source: Schema.Literals(['CONFIRMED', 'ESTIMATED']),
    }),
  ),
})

/** 홈의 예상 부가세와 부가세 추이입니다. Bookkeeping 증빙을 포트로 읽어 그때 계산하고 저장하지 않습니다. */
export class VatEstimates extends Context.Service<
  VatEstimates,
  {
    /** `on`(기본 오늘)이 속한 기간의 예상 부가세입니다. 기간 시작부터 `on`까지의 증빙으로 계산합니다. */
    current(actor: Actor, on?: string): Effect.Effect<VatEstimateResponse>
    /** 올해를 포함한 `years`해의 반기별 부가세입니다. */
    trend(actor: Actor, years: number): Effect.Effect<{ items: VatTrendPoint[] }>
  }
>()('semu/tax/VatEstimates') {
  static readonly layer = Layer.effect(
    VatEstimates,
    Effect.gen(function* () {
      const evidence = yield* VatEvidence
      const profiles = yield* TaxProfiles
      const repository = yield* FilingRepository

      const ratioOf = (actor: Actor) =>
        profiles
          .get(actor.companyId)
          .pipe(
            Effect.map(
              Option.match({ onNone: () => FULL_RATIO_PPM, onSome: (profile) => profile.taxableCardRatioPpm }),
            ),
          )

      const current = Effect.fn('VatEstimates.current')(function* (actor: Actor, on?: string) {
        const { today } = yield* currentInstant
        const asOf = on ?? today
        const period = vatEstimatePeriod(actor.businessType, asOf)
        const [sales, purchases, ratio] = yield* Effect.all([
          evidence.sales(actor.companyId, period.start, asOf),
          evidence.purchases(actor.companyId, period.start, asOf),
          ratioOf(actor),
        ])
        const estimate: VatEstimate = estimateVat({
          period: { ...period, end: asOf },
          sales,
          purchases,
          taxableCardRatioPpm: ratio,
        })
        return { ...estimate, period, asOf }
      })

      const trend = Effect.fn('VatEstimates.trend')(function* (actor: Actor, years: number) {
        const { today } = yield* currentInstant
        const from = vatHalfPeriod(Number(today.slice(0, 4)) - years + 1, 1).start
        const [sales, purchases, ratio, filings] = yield* Effect.all([
          evidence.sales(actor.companyId, from, today),
          evidence.purchases(actor.companyId, from, today),
          ratioOf(actor),
          repository.list(actor.companyId, { taxTypes: ['VAT'] }),
        ])
        const items = vatTrend({
          today,
          years,
          hasTaxationPlan: actor.plans.has('TAXATION'),
          filings,
          estimate: (period) => estimateVat({ period, sales, purchases, taxableCardRatioPpm: ratio }).estimatedTax,
        })
        return { items }
      })

      return VatEstimates.of({ current, trend })
    }),
  )
}
