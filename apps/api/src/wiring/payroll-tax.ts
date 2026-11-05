import { Effect, Layer } from 'effect'
import { Outbox } from '../shared/persistence/outbox.ts'
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
 * Payroll의 `PayrollEventPublisher` 포트를 outbox 채널 `payroll_pay_month->tax`로 Tax에 넘기는 구현입니다.
 *
 * `payroll_pay_month.closed`·`payroll_pay_month.reopened`를 받으면 그 지급월의 원천세 신고 건을 Payroll의 현재 마감 현황으로
 * 다시 맞춥니다(`PayrollLedgerSync`). Tax에는 회사와 지급월만 넘기고, 원천세 집계 같은 급여 금액은 넘기지 않습니다.
 * SQLite에서는 대장 커맨드의 트랜잭션이 커밋된 뒤 Tax 반영이 자기 트랜잭션에서 돌고, 그 뒤에 커맨드 응답이 나갑니다.
 * Tax 반영이 실패해도 커맨드는 이미 커밋되어 2xx로 끝나며, 실패한 이벤트는 릴레이가 다시 넘깁니다. 메모리 저장소에서는 커맨드 안에서 바로 부릅니다.
 */
export const PayrollEventsToTax: Layer.Layer<PayrollEventPublisher, never, PayrollLedgerSync | Outbox> = Layer.effect(
  PayrollEventPublisher,
  Effect.gen(function* () {
    const sync = yield* PayrollLedgerSync
    const publish = yield* (yield* Outbox).channel<PayrollEvent>('payroll_pay_month->tax', (event) =>
      sync.apply(payrollLedgerChangeOf(event)),
    )
    return PayrollEventPublisher.of({ publish })
  }),
)

function payrollLedgerChangeOf(event: PayrollEvent): PayrollLedgerChanged {
  return { companyId: event.companyId, paymentMonth: event.paymentMonth }
}
