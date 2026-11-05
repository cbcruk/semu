import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../shared/ids/ids.types.ts'
import type { FilingKind, FilingStatus, TaxType } from './tax.types.ts'

/**
 * Tax가 내보내는 도메인 이벤트입니다. 다른 컨텍스트는 이 타입과 {@link WithholdingFilingLock}만 봅니다.
 *
 * - `filing.status_changed`: 신고 건 상태가 바뀌었습니다. Payroll은 원천세가 `FILED`가 되면 그 지급월 급여대장을 잠급니다
 */
export interface FilingStatusChanged {
  type: 'filing.status_changed'
  companyId: Id<'company'>
  filingId: Id<'filing'>
  taxType: TaxType
  kind: FilingKind
  periodStart: string
  periodEnd: string
  fromStatus: FilingStatus
  toStatus: FilingStatus
  /** 납부할 세액입니다. 신고 뒤에만 있습니다. */
  payableAmount: number | null
  occurredAt: string
}

/** Tax 이벤트 전체입니다. */
export type TaxEvent = FilingStatusChanged

/**
 * Tax가 받는 Payroll의 사실입니다. 급여대장이 마감되거나 마감이 풀리면 그 지급월을 알려 줍니다.
 *
 * `app.ts`가 Payroll의 `payroll_ledger.closed`·`payroll_ledger.reopened` 이벤트를 이 형태로 바꿔 `Filings.syncPayrollLedger`에 넘깁니다.
 */
export interface PayrollLedgerChanged {
  companyId: Id<'company'>
  /** 급여 지급월입니다(`YYYY-MM`). 원천세는 지급 시기 기준입니다. */
  paymentMonth: string
}

/**
 * 이벤트를 내보내는 포트입니다. 지금은 메모리 구현만 있고, 아웃박스가 생기면 같은 트랜잭션에 쓰는 구현으로 바꿉니다.
 */
export class TaxEvents extends Context.Service<
  TaxEvents,
  {
    publish(events: ReadonlyArray<TaxEvent>): Effect.Effect<void>
  }
>()('semu/tax/TaxEvents') {
  /** 내보낸 이벤트를 `log`에 쌓습니다. 테스트는 배열을 넘겨 내보낸 이벤트를 봅니다. */
  static readonly layerMemory = (log: TaxEvent[] = []) =>
    Layer.succeed(
      TaxEvents,
      TaxEvents.of({
        publish: (events) =>
          Effect.sync(() => {
            log.push(...events)
          }),
      }),
    )
}

/**
 * 원천세 신고 여부를 묻는 공개 조회입니다. Payroll이 지급월 급여대장을 잠글지 정할 때 씁니다.
 *
 * 그 지급월을 덮는 원천세 신고 건(가장 최근 수정분)이 `FILED`·`SETTLED`면 참입니다. 구현은 Tax의 `tax.layer.ts`에 있습니다.
 */
export class WithholdingFilingLock extends Context.Service<
  WithholdingFilingLock,
  {
    isFiled(companyId: Id<'company'>, paymentMonth: string): Effect.Effect<boolean>
  }
>()('semu/tax/WithholdingFilingLock') {}
