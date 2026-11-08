import { Effect, Layer } from 'effect'
import { PayrollLedgerSummary, PayrollWithholdingTotals } from '../modules/payroll/payroll.public.ts'
import { PayrollLedgers, WithholdingTotals } from '../modules/tax/tax.public.ts'

/**
 * Tax의 `PayrollLedgers` 포트를 Payroll의 `PayrollLedgerSummary`로 구현합니다.
 *
 * 원천세 신고 기간(지급일 기준)에 지급한 급여대장 수와 그중 마감된 수를 셉니다. 모두 마감이면 "급여대장 마감" 항목이 제출됨이 됩니다.
 */
export const TaxPayrollLedgersFromPayroll: Layer.Layer<PayrollLedgers, never, PayrollLedgerSummary> = Layer.effect(
  PayrollLedgers,
  Effect.gen(function* () {
    const payroll = yield* PayrollLedgerSummary
    return PayrollLedgers.of({
      summaryFor: (companyId, paidFrom, paidTo) => payroll.summaryFor(companyId, paidFrom, paidTo),
    })
  }),
)

/**
 * Tax의 `WithholdingTotals` 포트를 Payroll의 `PayrollWithholdingTotals`로 구현합니다.
 *
 * 지급월에 지급한 마감 급여대장과 완료 퇴직금 정산의 소득 종류별 원천세 합계입니다. Payroll의 소득 종류(`WAGE`·`DAILY`·
 * `BUSINESS`·`OTHER`·`RETIREMENT`)는 Tax의 소득 종류에 그대로 들어가고, 신고서 줄 코드로 바꾸는 것은 Tax가 합니다.
 */
export const TaxWithholdingTotalsFromPayroll: Layer.Layer<WithholdingTotals, never, PayrollWithholdingTotals> =
  Layer.effect(
    WithholdingTotals,
    Effect.gen(function* () {
      const payroll = yield* PayrollWithholdingTotals
      return WithholdingTotals.of({
        totalsFor: (companyId, paymentMonth) => payroll.totalsFor(companyId, paymentMonth),
      })
    }),
  )
