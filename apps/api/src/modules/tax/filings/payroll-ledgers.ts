import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { PayrollLedgerSummary } from './filing-requirements.types.ts'

/**
 * 원천세 신고 기간에 지급한 급여대장의 마감 현황을 묻는 포트입니다. Payroll이 구현합니다.
 *
 * Tax는 Payroll 저장소를 직접 읽지 않습니다. 기간은 지급일 기준입니다.
 */
export class PayrollLedgers extends Context.Service<
  PayrollLedgers,
  {
    summaryFor(companyId: Id<'company'>, paidFrom: string, paidTo: string): Effect.Effect<PayrollLedgerSummary>
  }
>()('semu/tax/PayrollLedgers') {
  /**
   * 지급월(`YYYY-MM`)별 현황을 정해 둔 가짜입니다. 기간에 걸친 달의 현황을 더합니다.
   *
   * @example
   * ```ts
   * PayrollLedgers.layerMemory({ '2026-10': { ledgerCount: 2, closedCount: 2 } })
   * ```
   */
  static readonly layerMemory = (byMonth: Readonly<Record<string, PayrollLedgerSummary>> = {}) =>
    Layer.succeed(
      PayrollLedgers,
      PayrollLedgers.of({
        summaryFor: (_companyId, paidFrom, paidTo) =>
          Effect.succeed(
            Object.entries(byMonth)
              .filter(([month]) => month >= paidFrom.slice(0, 7) && month <= paidTo.slice(0, 7))
              .reduce(
                (sum, [, summary]) => ({
                  ledgerCount: sum.ledgerCount + summary.ledgerCount,
                  closedCount: sum.closedCount + summary.closedCount,
                }),
                { ledgerCount: 0, closedCount: 0 },
              ),
          ),
      }),
    )
}
