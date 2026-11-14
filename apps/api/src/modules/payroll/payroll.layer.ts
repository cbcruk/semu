import { Layer } from 'effect'
import { TableFactory } from '../../shared/persistence/record-table.ts'
import { PersonalDataAccessLog } from '../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../shared/personal-data/personal-data-cipher.ts'
import { EarnerRepository } from './earners/earner-repository.ts'
import { EarnersHttpLive } from './earners/earners.http.ts'
import { PayrollItemRepository } from './items/payroll-item-repository.ts'
import { DeductionItemsHttpLive, PaymentItemsHttpLive } from './items/payroll-items.http.ts'
import { LaborCostReportsHttpLive } from './labor-cost/labor-cost-reports.http.ts'
import { PayrollLaborCost } from './labor-cost/payroll-labor-cost.ts'
import { PayrollLedgerRepository } from './ledgers/payroll-ledger-repository.ts'
import { PayrollLedgerSummary } from './ledgers/payroll-ledger-summary.ts'
import { PayrollWithholdingTotals } from './ledgers/payroll-withholding-totals.ts'
import { PayrollLedgerApprovalsHttpLive, PayrollLedgersHttpLive } from './ledgers/payroll-ledgers.http.ts'
import { PAYROLL_DEMO_EMPLOYEES } from './payroll-demo.ts'
import { PayslipRepository } from './payslips/payslip-repository.ts'
import { PayslipsHttpLive } from './payslips/payslips.http.ts'
import { PayrollEmployeeDirectory } from './ports/payroll-employee-directory.ts'
import { PayrollEventPublisher } from './ports/payroll-events.ts'
import { PayslipMailer } from './ports/payslip-mailer.ts'
import { WithholdingFilingLock } from './ports/withholding-filing-lock.ts'
import { RateTableRepository } from './rate-tables/rate-table-repository.ts'
import { PayrollCalculatorHttpLive, RateTablesHttpLive } from './rate-tables/rate-tables.http.ts'
import { PayrollSettingQuery } from './settings/payroll-setting-query.ts'
import { PayrollSettingRepository } from './settings/payroll-setting-repository.ts'
import { PayrollSettingsHttpLive } from './settings/payroll-settings.http.ts'
import { SeveranceSettlementQuery } from './severance/severance-settlement-query.ts'
import { SeveranceSettlementRepository } from './severance/severance-settlement-repository.ts'
import { SeveranceSettlementsHttpLive } from './severance/severance-settlements.http.ts'
import { WageTaxSettlementRepository } from './wage-settlements/wage-tax-settlement-repository.ts'
import { WageTaxSettlementsHttpLive } from './wage-settlements/wage-tax-settlements.http.ts'

/**
 * 급여 계산 엔진·기준표·급여 설정·지급·공제 항목·소득자 명부·급여대장·명세서·퇴직금·인건비 컨텍스트의 핸들러 전체입니다.
 *
 * 저장소와 포트(`PayrollEmployeeDirectory`, `WithholdingFilingLock`, `PayrollEventPublisher`, `PayslipMailer`), HR과 함께 쓰는
 * 개인정보 암호화(`PersonalDataCipher`)·열람 기록(`PersonalDataAccessLog`)은 호출하는 쪽이 넣습니다.
 */
export const PayrollHttpLive = Layer.mergeAll(
  RateTablesHttpLive,
  PayrollCalculatorHttpLive,
  PayrollSettingsHttpLive,
  PaymentItemsHttpLive,
  DeductionItemsHttpLive,
  PayrollLedgersHttpLive,
  PayrollLedgerApprovalsHttpLive,
  EarnersHttpLive,
  PayslipsHttpLive,
  SeveranceSettlementsHttpLive,
  WageTaxSettlementsHttpLive,
  LaborCostReportsHttpLive.pipe(Layer.provide(PayrollLaborCost.layer)),
)

/**
 * 다른 컨텍스트에 여는 서비스(`payroll.public.ts`)입니다. 지급일 구간의 급여대장 마감 현황, 지급월 원천세 합계, 월별 인건비, 직원별 퇴직금 정산 상태, 사업장 규모(5인 미만 여부)입니다.
 *
 * `PayrollLedgerRepository`, `SeveranceSettlementRepository`, `PayrollSettingRepository`와 HR 포트(`PayrollEmployeeDirectory`)가 필요합니다. 인건비 보고서 핸들러와 같은 Layer를 쓰므로
 * `Layer.fresh`로 따로 만듭니다. 그래야 테스트가 핸들러 쪽 포트만 바꿔 끼워도 이 서비스가 먼저 만든 인스턴스를 핸들러가 물려받지 않습니다.
 */
export const PayrollPublicLive = Layer.fresh(
  Layer.mergeAll(
    PayrollLedgerSummary.layer,
    PayrollWithholdingTotals.layer,
    PayrollLaborCost.layer,
    SeveranceSettlementQuery.layer,
    PayrollSettingQuery.layer,
  ),
)

/**
 * 급여 컨텍스트가 소유한 저장소입니다. 급여 설정·지급·공제 항목·소득자 명부·급여대장(행 포함)·명세서·명세서 멱등 응답·퇴직금 정산·근로소득 정산은
 * `TableFactory`(메모리 또는 SQLite)의 `payroll_*` 표에 둡니다.
 *
 * 기준표는 코드에 컴파일된 참조 데이터라 표에 두지 않습니다. 명세서 메일(`PayslipMailer`)은 Integrations에 메일 연동이
 * 아직 없어 가짜를 함께 넣습니다. HR·Tax 포트는 넣지 않습니다. `app.ts`가 `src/wiring/`의 어댑터로 채웁니다.
 */
export const PayrollStoreLive = Layer.mergeAll(
  RateTableRepository.layerMemory(),
  PayrollSettingRepository.layer(),
  PayrollItemRepository.layer(),
  EarnerRepository.layer(),
  PayrollLedgerRepository.layer(),
  PayslipRepository.layer(),
  SeveranceSettlementRepository.layer(),
  WageTaxSettlementRepository.layer(),
  PayslipMailer.layerFake,
)

/** {@link PayrollStoreLive}를 메모리 표와 가짜 암호화로 채우고 열람 기록을 함께 넣습니다. */
export const PayrollMemoryStoreLive = Layer.mergeAll(
  PayrollStoreLive,
  PersonalDataAccessLog.layer,
  PersonalDataCipher.layerFake,
).pipe(Layer.provide(TableFactory.layerMemory))

/**
 * HR·Tax 포트의 결정적인 가짜입니다. Payroll만 시험할 때 {@link PayrollMemoryStoreLive}와 함께 씁니다.
 *
 * HR 포트 가짜에는 데모 회사 직원 두 명이 들어 있고, 원천세는 신고된 달이 없으며, 이벤트는 버립니다.
 */
export const PayrollPortFakesLive = Layer.mergeAll(
  PayrollEmployeeDirectory.layerMemory(PAYROLL_DEMO_EMPLOYEES),
  WithholdingFilingLock.layerMemory(),
  PayrollEventPublisher.layerMemory(),
)

/** 급여 컨텍스트의 저장소를 메모리 구현으로, HR·Tax·메일 포트를 결정적인 가짜로 채웁니다. Payroll만 시험할 때 씁니다. */
export const PayrollMemoryLive = Layer.mergeAll(PayrollMemoryStoreLive, PayrollPortFakesLive)
