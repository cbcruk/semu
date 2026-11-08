import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { relinkRequirements } from './filing-requirements.ts'
import type { PayrollLedgerSummary } from './filing-requirements.types.ts'
import type { FilingRecord } from './filing.types.ts'

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

/**
 * 신고 건의 자동 연계 항목을 Payroll의 현재 마감 현황으로 다시 맞춥니다({@link relinkRequirements}). 고객·대리인이 답한 항목은 그대로 둡니다.
 *
 * 응답이 바뀐 항목마다 이력 `REQUIREMENT_LINKED`(`detail`에 `code`·`response`를 더함)를 붙입니다. 버전과 `updatedAt`은
 * 부르는 쪽이 올리고 저장합니다. 자동 연계 항목이 없으면 Payroll에 묻지 않고, 바뀐 항목이 없으면 `changed`가 거짓입니다.
 * 급여대장 이벤트(`Filings.syncPayrollLedger`)와 일정 배치의 되살리기가 함께 씁니다.
 */
export const relinkAutoRequirements = Effect.fn('PayrollLedgers.relinkAutoRequirements')(function* (
  ledgers: PayrollLedgers['Service'],
  filing: FilingRecord,
  now: string,
  detail: Record<string, string | number> = {},
) {
  if (!filing.requirements.some((requirement) => requirement.autoLinked)) return { filing, changed: false }
  const summary = yield* ledgers.summaryFor(filing.companyId, filing.periodStart, filing.periodEnd)
  const relinked = relinkRequirements(filing.requirements, summary, now)
  if (relinked.changed.length === 0) return { filing, changed: false }
  const relinkedFiling: FilingRecord = {
    ...filing,
    requirements: relinked.requirements,
    history: [
      ...filing.history,
      ...relinked.changed.map(({ code, response }): FilingRecord['history'][number] => ({
        type: 'REQUIREMENT_LINKED',
        actorKind: 'SYSTEM',
        actorId: null,
        fromStatus: null,
        toStatus: null,
        detail: { code, response, ...detail },
        occurredAt: now,
      })),
    ],
  }
  return { filing: relinkedFiling, changed: true }
})
