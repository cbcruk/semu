import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../shared/ids/ids.types.ts'
import type { BusinessType, Plan } from '../identity-access/actor.types.ts'
import type { FilingKind, FilingStatus, TaxType } from './tax.types.ts'

export { PayrollLedgers } from './filings/payroll-ledgers.ts'
export type { PayrollLedgerSummary } from './filings/filing-requirements.types.ts'
export { WithholdingTotals } from './filings/withholding-totals.ts'
export type {
  OtherIncomeCategory,
  WithholdingIncomeKind,
  WithholdingTotal,
} from './filings/withholding-return.types.ts'
export { PublicHolidays } from './calendar/public-holidays.ts'
export { TaxProfiles, type TaxProfile } from './calendar/tax-profiles.ts'
export { VatEvidence } from './vat-estimates/vat-evidence.ts'
export type {
  PurchaseEvidence,
  PurchaseSource,
  SalesEvidence,
  SalesSource,
} from './vat-estimates/vat-estimate.types.ts'

/**
 * Tax가 내보내는 도메인 이벤트입니다.
 *
 * - `filing.status_changed`: 신고 건 상태가 바뀌었습니다. 지금은 소비자가 없습니다. Payroll의 급여대장 잠금은 이 이벤트가 아니라
 *   `WithholdingFilingLock` 조회로 판정합니다
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
 * `app.ts`의 어댑터가 Payroll의 `payroll_pay_month.closed`·`payroll_pay_month.reopened` 이벤트를 이 형태로 바꿔
 * {@link PayrollLedgerSync}에 넘깁니다.
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

/**
 * 급여대장 마감 변화를 원천세 신고 건에 반영하는 공개 커맨드입니다. Payroll 이벤트의 구독자가 부릅니다.
 *
 * 그 지급월을 덮는 원천세 신고 건의 "급여대장 마감" 항목을 Payroll의 현재 마감 현황으로 다시 맞춥니다. 같은 변화를 두 번 받아도 결과가 같습니다.
 */
export class PayrollLedgerSync extends Context.Service<
  PayrollLedgerSync,
  {
    apply(change: PayrollLedgerChanged): Effect.Effect<void>
  }
>()('semu/tax/PayrollLedgerSync') {}

/** 다른 컨텍스트에 보이는 예상 부가세입니다. */
export interface CompanyVatEstimate {
  /** 날짜가 속한 예상 부가세 기간입니다. 법인은 분기, 개인은 반기입니다. */
  period: { start: string; end: string; unit: 'QUARTER' | 'HALF' }
  /** 계산에 쓴 증빙의 마지막 날입니다. */
  asOf: string
  /** 예상 세액입니다. 음수면 환급 예상입니다. */
  estimatedTax: number
  /** 그 기간 신고의 납부 기한입니다. 기간 다음 달 25일을 주말·공휴일만큼 미룬 날입니다. */
  dueDate: string
}

/**
 * 예상 부가세 공개 조회입니다. Bookkeeping의 홈 경영 현황 카드가 씁니다.
 *
 * 화면의 `GET /vat-estimates/current`와 같은 계산이고, 행위자 대신 회사와 사업자 형태를 받습니다.
 */
export class VatEstimateQuery extends Context.Service<
  VatEstimateQuery,
  {
    current(companyId: Id<'company'>, businessType: BusinessType, asOf: string): Effect.Effect<CompanyVatEstimate>
  }
>()('semu/tax/VatEstimateQuery') {}

/** 대리인 담당 회사 하나의 세무 일감 개수입니다. */
export interface CompanyTaxWorkload {
  companyId: Id<'company'>
  /** 끝나지 않은 신고 건 수입니다. `TAXATION` 회사만 셉니다. */
  openFilingCount: number
  /** 그중 기한(신고 기한, 없으면 납부 기한)이 회사 시간대 오늘보다 앞이고 아직 신고하지 않은 건 수입니다. */
  overdueFilingCount: number
  /** 회사 플랜으로 볼 수 있는 진행중 할 일 카드 수입니다. */
  openActionCardCount: number
  /** 끝나지 않은 신고 건의 가장 가까운 기한입니다. */
  nearestDueDate: string | null
}

/**
 * 여러 회사의 세무 일감 개수 공개 조회입니다. Identity & Access의 대리인 담당 회사 목록(`GET /agency/companies`)이 씁니다.
 *
 * 배정은 Identity & Access가 정하고, 여기서는 넘어온 회사만 셉니다. 회사마다 플랜을 받아 회사 범위 목록과 같은 요건으로 거릅니다.
 */
export class AgencyWorkloadQuery extends Context.Service<
  AgencyWorkloadQuery,
  {
    /** 넘긴 회사마다 하나씩, 같은 순서로 돌려줍니다. */
    of(
      companies: ReadonlyArray<{ companyId: Id<'company'>; plans: ReadonlySet<Plan> }>,
    ): Effect.Effect<ReadonlyArray<CompanyTaxWorkload>>
  }
>()('semu/tax/AgencyWorkloadQuery') {}
