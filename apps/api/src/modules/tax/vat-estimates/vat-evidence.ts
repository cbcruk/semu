import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { PurchaseEvidence, SalesEvidence } from './vat-estimate.types.ts'

/**
 * 예상 부가세에 쓰는 매출·매입 증빙을 읽는 포트입니다. Bookkeeping이 구현합니다.
 *
 * 매출은 발행일 순, 같은 날은 ID 순이어야 합니다. 중복 묶음(`dedupeGroup`)에서 먼저 온 건을 남기기 때문입니다.
 */
export class VatEvidence extends Context.Service<
  VatEvidence,
  {
    sales(companyId: Id<'company'>, from: string, to: string): Effect.Effect<ReadonlyArray<SalesEvidence>>
    purchases(companyId: Id<'company'>, from: string, to: string): Effect.Effect<ReadonlyArray<PurchaseEvidence>>
  }
>()('semu/tax/VatEvidence') {
  /** 정해 둔 증빙으로 답하는 가짜입니다. 회사를 가리지 않습니다. */
  static readonly layerMemory = (
    seed: { sales?: ReadonlyArray<SalesEvidence>; purchases?: ReadonlyArray<PurchaseEvidence> } = {},
  ) =>
    Layer.succeed(
      VatEvidence,
      VatEvidence.of({
        sales: (_companyId, from, to) =>
          Effect.succeed(
            (seed.sales ?? [])
              .filter((row) => row.issuedOn >= from && row.issuedOn <= to)
              .toSorted((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.id.localeCompare(b.id)),
          ),
        purchases: (_companyId, from, to) =>
          Effect.succeed((seed.purchases ?? []).filter((row) => row.issuedOn >= from && row.issuedOn <= to)),
      }),
    )
}
