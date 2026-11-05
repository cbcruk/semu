import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PayrollLedgerRepository } from './payroll-ledger-repository.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

/** 지급일 구간의 대장 수와 마감된 대장 수입니다. */
export interface PayrollLedgerCount {
  ledgerCount: number
  closedCount: number
}

/** 지급일이 `[paidFrom, paidTo]`(양 끝 포함, `YYYY-MM-DD`)에 드는 대장을 셉니다. */
export function countLedgersPaidBetween(
  ledgers: ReadonlyArray<PayrollLedgerRecord>,
  paidFrom: string,
  paidTo: string,
): PayrollLedgerCount {
  const paid = ledgers.filter((ledger) => ledger.paymentDate >= paidFrom && ledger.paymentDate <= paidTo)
  return { ledgerCount: paid.length, closedCount: paid.filter((ledger) => ledger.status === 'CLOSED').length }
}

/**
 * 원천세 신고 건이 "급여대장 마감" 자료를 다시 맞출 때 쓰는 조회입니다. `payroll.public.ts`로 공개합니다.
 *
 * Tax의 `PayrollLedgers.summaryFor` 포트를 `app.ts`에서 이 서비스로 구현합니다.
 */
export class PayrollLedgerSummary extends Context.Service<
  PayrollLedgerSummary,
  {
    /** 지급일 기준으로 센 대장 수와 마감된 대장 수입니다. */
    summaryFor(companyId: Id<'company'>, paidFrom: string, paidTo: string): Effect.Effect<PayrollLedgerCount>
  }
>()('semu/payroll/PayrollLedgerSummary') {
  /** 급여대장 저장소로 만듭니다. */
  static readonly layer = Layer.effect(
    PayrollLedgerSummary,
    Effect.gen(function* () {
      const ledgers = yield* PayrollLedgerRepository
      return PayrollLedgerSummary.of({
        summaryFor: (companyId, paidFrom, paidTo) =>
          ledgers.list(companyId).pipe(Effect.map((all) => countLedgersPaidBetween(all, paidFrom, paidTo))),
      })
    }),
  )
}
