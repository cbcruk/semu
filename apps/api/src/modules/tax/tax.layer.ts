import { Effect, Layer } from 'effect'
import { TableFactory } from '../../shared/persistence/record-table.ts'
import { addDays, addMonths } from '../../shared/time/calendar.ts'
import { ActionCardRepository } from './action-cards/action-card-repository.ts'
import type { ActionCardRecord } from './action-cards/action-card.ts'
import { ActionCards } from './action-cards/action-cards.ts'
import { ActionCardsHttpLive } from './action-cards/action-cards.http.ts'
import { rollForwardDeadline } from './calendar/filing-deadline.ts'
import { FilingScheduler } from './calendar/filing-scheduler.ts'
import { PublicHolidays } from './calendar/public-holidays.ts'
import { TaxCalendar } from './calendar/tax-calendar.ts'
import { TaxCalendarHttpLive } from './calendar/tax-calendar.http.ts'
import { TaxProfiles } from './calendar/tax-profiles.ts'
import type { TaxProfile } from './calendar/tax-profiles.ts'
import type { FilingRecord } from './filings/filing.types.ts'
import type { PayrollLedgerSummary } from './filings/filing-requirements.types.ts'
import { FilingRepository } from './filings/filing-repository.ts'
import { Filings } from './filings/filings.ts'
import { FilingsHttpLive } from './filings/filings.http.ts'
import { PayrollLedgers } from './filings/payroll-ledgers.ts'
import { DEMO_FILINGS, DEMO_HOLIDAYS, DEMO_TAX_PROFILE, DEMO_VAT_EVIDENCE } from './tax-demo.ts'
import { PayrollLedgerSync, TaxEvents, VatEstimateQuery, WithholdingFilingLock } from './tax.public.ts'
import type { TaxEvent } from './tax.public.ts'
import type { PurchaseEvidence, SalesEvidence } from './vat-estimates/vat-estimate.types.ts'
import { VatEvidence } from './vat-estimates/vat-evidence.ts'
import { makeVatEstimator, VatEstimates } from './vat-estimates/vat-estimates.ts'
import { VatEstimatesHttpLive } from './vat-estimates/vat-estimates.http.ts'

const ActionCardsLive = ActionCards.layer

const FilingsLive = Filings.layer.pipe(Layer.provide(ActionCardsLive))

/**
 * 세무 신고 건·세무 일정·할 일 카드·예상 부가세 컨텍스트의 핸들러 전체입니다.
 *
 * 저장소(`FilingRepository`·`ActionCardRepository`)와 포트(`TaxEvents`·`PayrollLedgers`·`TaxProfiles`·
 * `PublicHolidays`·`VatEvidence`)는 호출하는 쪽이 넣습니다.
 */
export const TaxHttpLive = Layer.mergeAll(
  FilingsHttpLive.pipe(Layer.provide(FilingsLive)),
  ActionCardsHttpLive.pipe(Layer.provide(ActionCardsLive)),
  TaxCalendarHttpLive.pipe(Layer.provide(TaxCalendar.layer)),
  VatEstimatesHttpLive.pipe(Layer.provide(VatEstimates.layer)),
)

/** 일정 배치입니다. 매일 배치와 공휴일표·세무 설정 변경 뒤에 `run`을 부릅니다. 필요한 저장소·포트는 {@link TaxHttpLive}와 같습니다. */
export const FilingSchedulerLive = FilingScheduler.layer.pipe(Layer.provide(ActionCardsLive))

/** Payroll이 급여대장 잠금에 쓰는 원천세 신고 여부 조회입니다. `FilingRepository`가 필요합니다. */
export const WithholdingFilingLockLive = Layer.effect(
  WithholdingFilingLock,
  Effect.gen(function* () {
    const repository = yield* FilingRepository
    return WithholdingFilingLock.of({
      isFiled: (companyId, paymentMonth) =>
        repository.list(companyId, { taxTypes: ['WITHHOLDING_TAX'], covering: `${paymentMonth}-01` }).pipe(
          Effect.map((filings) => {
            const latest = filings
              .filter((filing) => filing.status !== 'CANCELED')
              .toSorted((a, b) => b.revision - a.revision)[0]
            return latest !== undefined && (latest.status === 'FILED' || latest.status === 'SETTLED')
          }),
        ),
    })
  }),
)

/** 원천세 신고 건의 "급여대장 마감" 항목을 Payroll 이벤트로 다시 맞춥니다. 필요한 저장소·포트는 {@link TaxHttpLive}와 같습니다. */
export const PayrollLedgerSyncLive = Layer.effect(
  PayrollLedgerSync,
  Effect.gen(function* () {
    const filings = yield* Filings
    return PayrollLedgerSync.of({
      apply: (change) => filings.syncPayrollLedger(change.companyId, change.paymentMonth),
    })
  }),
).pipe(Layer.provide(FilingsLive))

/** 예상 부가세 공개 조회입니다. `VatEvidence`·`TaxProfiles`·`PublicHolidays` 포트가 필요합니다. */
export const VatEstimateQueryLive = Layer.effect(
  VatEstimateQuery,
  Effect.gen(function* () {
    const estimator = makeVatEstimator(yield* VatEvidence, yield* TaxProfiles)
    const holidays = yield* PublicHolidays
    return VatEstimateQuery.of({
      current: (companyId, businessType, asOf) =>
        Effect.gen(function* () {
          const estimate = yield* estimator.estimate(companyId, businessType, asOf)
          const statutoryDue = `${addMonths(estimate.period.end.slice(0, 7), 1)}-25`
          const closed = yield* holidays.between(statutoryDue, addDays(statutoryDue, 31))
          return {
            period: estimate.period,
            asOf: estimate.asOf,
            estimatedTax: estimate.estimatedTax,
            dueDate: rollForwardDeadline(statutoryDue, closed),
          }
        }),
    })
  }),
)

/**
 * 다른 컨텍스트에 여는 서비스(`tax.public.ts`)입니다. 원천세 신고 여부, 급여대장 마감 반영, 예상 부가세입니다.
 *
 * 필요한 저장소·포트는 {@link TaxHttpLive}와 같습니다. 핸들러가 쓰는 내부 서비스 Layer를 함께 쓰므로 `Layer.fresh`로 따로 만듭니다.
 * 그래야 테스트가 핸들러 쪽 저장소만 바꿔 끼워도 이 서비스가 먼저 만든 인스턴스를 핸들러가 물려받지 않습니다.
 */
export const TaxPublicLive = Layer.fresh(
  Layer.mergeAll(WithholdingFilingLockLive, PayrollLedgerSyncLive, VatEstimateQueryLive),
)

/** {@link taxMemoryLayer}의 시작 데이터입니다. 주지 않은 값은 비어 있습니다. */
export interface TaxMemorySeed {
  filings?: ReadonlyArray<FilingRecord>
  actionCards?: ReadonlyArray<ActionCardRecord>
  profiles?: ReadonlyArray<TaxProfile>
  holidays?: ReadonlyArray<string>
  payrollLedgers?: Readonly<Record<string, PayrollLedgerSummary>>
  vatEvidence?: { sales?: ReadonlyArray<SalesEvidence>; purchases?: ReadonlyArray<PurchaseEvidence> }
  /** 내보낸 이벤트를 쌓을 배열입니다. */
  events?: TaxEvent[]
}

/** 저장소와 포트를 메모리 구현으로 채웁니다. 테스트는 시드를 넘겨 쓰고, 로컬 개발은 {@link TaxMemoryLive}를 씁니다. */
export function taxMemoryLayer(seed: TaxMemorySeed = {}) {
  return Layer.mergeAll(
    FilingRepository.layerMemory(seed.filings),
    ActionCardRepository.layerMemory(seed.actionCards),
    TaxEvents.layerMemory(seed.events),
    PayrollLedgers.layerMemory(seed.payrollLedgers),
    TaxProfiles.layerMemory(seed.profiles),
    PublicHolidays.layerMemory(seed.holidays),
    VatEvidence.layerMemory(seed.vatEvidence),
  )
}

/**
 * 세무 컨텍스트가 소유한 저장소와 이벤트 포트입니다. 표는 `TableFactory`(메모리 또는 SQLite)에 둡니다. 데모 회사에 신고 건 두 건이 있습니다.
 *
 * 다른 컨텍스트가 구현하는 포트(`PayrollLedgers`·`TaxProfiles`·`PublicHolidays`·`VatEvidence`)는 넣지 않습니다. `app.ts`가 `src/wiring/`의 어댑터로 채웁니다.
 */
export const TaxStoreLive = Layer.mergeAll(
  FilingRepository.layer(DEMO_FILINGS),
  ActionCardRepository.layer(),
  TaxEvents.layerMemory(),
)

/** {@link TaxStoreLive}를 메모리 표로 채웁니다. */
export const TaxMemoryStoreLive = TaxStoreLive.pipe(Layer.provide(TableFactory.layerMemory))

/** 세무 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 데모 회사에 신고 건 두 건이 있습니다. Tax만 시험할 때 씁니다. */
export const TaxMemoryLive = taxMemoryLayer({
  filings: DEMO_FILINGS,
  profiles: [DEMO_TAX_PROFILE],
  holidays: DEMO_HOLIDAYS,
  payrollLedgers: { '2026-10': { ledgerCount: 1, closedCount: 1 } },
  vatEvidence: DEMO_VAT_EVIDENCE,
})
