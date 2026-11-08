import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { WithholdingTotal } from './withholding-return.types.ts'

/**
 * 지급월에 지급한 소득 종류별 원천세 합계를 묻는 포트입니다. Payroll이 구현합니다(`src/wiring/tax-payroll.ts`).
 *
 * 이벤트로 금액을 받지 않고 필요할 때 묻습니다. outbox 재전달이나 마감·해제 순서와 상관없이 그때 Payroll이 가진 값을 받습니다.
 * Payroll은 마감된 급여대장과 완료한 퇴직금 정산(퇴직소득 `RETIREMENT`)만 더합니다.
 */
export class WithholdingTotals extends Context.Service<
  WithholdingTotals,
  {
    totalsFor(companyId: Id<'company'>, paymentMonth: string): Effect.Effect<ReadonlyArray<WithholdingTotal>>
  }
>()('semu/tax/WithholdingTotals') {
  /**
   * 지급월(`YYYY-MM`)별 합계를 정해 둔 가짜입니다. 정하지 않은 달은 비어 있습니다.
   *
   * @example
   * ```ts
   * WithholdingTotals.layerMemory({ '2026-10': [{ incomeKind: 'WAGE', headcount: 1, ... }] })
   * ```
   */
  static readonly layerMemory = (byMonth: Readonly<Record<string, ReadonlyArray<WithholdingTotal>>> = {}) =>
    Layer.succeed(
      WithholdingTotals,
      WithholdingTotals.of({ totalsFor: (_companyId, paymentMonth) => Effect.succeed(byMonth[paymentMonth] ?? []) }),
    )
}
