import { Effect, Layer } from 'effect'
import { PayrollLedgerSummary } from '../modules/payroll/payroll.public.ts'
import { PayrollLedgers } from '../modules/tax/tax.public.ts'

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
