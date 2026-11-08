import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { withholdingTotalsPaidIn } from './pay-month.ts'
import type { WithholdingSummaryLine } from './pay-month.types.ts'
import { PayrollLedgerRepository } from './payroll-ledger-repository.ts'

/**
 * 지급월의 소득 종류별 원천세 합계를 묻는 공개 조회입니다. `payroll.public.ts`로 공개합니다.
 *
 * Tax의 `WithholdingTotals` 포트를 `src/wiring/tax-payroll.ts`에서 이 서비스로 구현합니다. 이벤트에 금액을 싣지 않고
 * 조회로 주므로, Tax는 언제 물어도 그때 마감된 대장의 값을 받습니다.
 */
export class PayrollWithholdingTotals extends Context.Service<
  PayrollWithholdingTotals,
  {
    /** 지급일이 그 달(`YYYY-MM`)인 마감 대장의 소득 종류별 합계입니다. 행이 없는 종류는 빠집니다. */
    totalsFor(companyId: Id<'company'>, paymentMonth: string): Effect.Effect<ReadonlyArray<WithholdingSummaryLine>>
  }
>()('semu/payroll/PayrollWithholdingTotals') {
  /** 급여대장 저장소로 만듭니다. */
  static readonly layer = Layer.effect(
    PayrollWithholdingTotals,
    Effect.gen(function* () {
      const ledgers = yield* PayrollLedgerRepository
      return PayrollWithholdingTotals.of({
        totalsFor: (companyId, paymentMonth) =>
          ledgers.list(companyId).pipe(Effect.map((all) => withholdingTotalsPaidIn(all, paymentMonth))),
      })
    }),
  )
}
