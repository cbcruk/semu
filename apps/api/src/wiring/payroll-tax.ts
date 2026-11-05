import { Effect, Layer } from 'effect'
import { PayrollEventPublisher, WithholdingFilingLock } from '../modules/payroll/payroll.public.ts'
import type { PayrollEvent } from '../modules/payroll/payroll.public.ts'
import { PayrollLedgerSync, WithholdingFilingLock as TaxWithholdingFilingLock } from '../modules/tax/tax.public.ts'
import type { PayrollLedgerChanged } from '../modules/tax/tax.public.ts'

/**
 * Payroll의 `WithholdingFilingLock` 포트를 Tax의 원천세 신고 여부 조회로 구현합니다.
 *
 * 그 지급월을 덮는 원천세 신고 건(가장 최근 수정분)이 `FILED`·`SETTLED`면 급여대장의 금액을 바꾸는 커맨드가 막힙니다.
 */
export const PayrollWithholdingFilingLockFromTax: Layer.Layer<WithholdingFilingLock, never, TaxWithholdingFilingLock> =
  Layer.effect(
    WithholdingFilingLock,
    Effect.gen(function* () {
      const tax = yield* TaxWithholdingFilingLock
      return WithholdingFilingLock.of({ isFiled: (companyId, paymentMonth) => tax.isFiled(companyId, paymentMonth) })
    }),
  )

/**
 * Payroll의 `PayrollEventPublisher` 포트를 같은 프로세스에서 Tax에 바로 넘기는 구현입니다. 아웃박스가 생기기 전까지 씁니다.
 *
 * `payroll_pay_month.closed`·`payroll_pay_month.reopened`를 받으면 그 지급월의 원천세 신고 건을 Payroll의 현재 마감 현황으로
 * 다시 맞춥니다(`PayrollLedgerSync`). Tax에는 회사와 지급월만 넘기고, 원천세 집계 같은 급여 금액은 넘기지 않습니다.
 * 대장 커맨드와 같은 요청 안에서 동기로 돌기 때문에 Tax 쪽 반영이 끝나야 커맨드 응답이 나갑니다.
 */
export const PayrollEventsToTax: Layer.Layer<PayrollEventPublisher, never, PayrollLedgerSync> = Layer.effect(
  PayrollEventPublisher,
  Effect.gen(function* () {
    const sync = yield* PayrollLedgerSync
    return PayrollEventPublisher.of({ publish: (event) => sync.apply(payrollLedgerChangeOf(event)) })
  }),
)

function payrollLedgerChangeOf(event: PayrollEvent): PayrollLedgerChanged {
  return { companyId: event.companyId, paymentMonth: event.paymentMonth }
}
