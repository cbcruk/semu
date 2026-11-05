import { Layer } from 'effect'
import { LaborCostReportsHttpLive } from './labor-cost/labor-cost-reports.http.ts'
import { PayrollLaborCost } from './labor-cost/payroll-labor-cost.ts'
import { PayrollLedgerRepository } from './ledgers/payroll-ledger-repository.ts'
import { PayrollLedgerSummary } from './ledgers/payroll-ledger-summary.ts'
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
import { PayrollSettingRepository } from './settings/payroll-setting-repository.ts'
import { PayrollSettingsHttpLive } from './settings/payroll-settings.http.ts'
import { SeveranceSettlementRepository } from './severance/severance-settlement-repository.ts'
import { SeveranceSettlementsHttpLive } from './severance/severance-settlements.http.ts'

/**
 * 급여 계산 엔진·기준표·급여 설정·급여대장·명세서·퇴직금·인건비 컨텍스트의 핸들러 전체입니다.
 *
 * 저장소와 포트(`PayrollEmployeeDirectory`, `WithholdingFilingLock`, `PayrollEventPublisher`, `PayslipMailer`)는 호출하는 쪽이 넣습니다.
 */
export const PayrollHttpLive = Layer.mergeAll(
  RateTablesHttpLive,
  PayrollCalculatorHttpLive,
  PayrollSettingsHttpLive,
  PayrollLedgersHttpLive,
  PayrollLedgerApprovalsHttpLive,
  PayslipsHttpLive,
  SeveranceSettlementsHttpLive,
  LaborCostReportsHttpLive.pipe(Layer.provide(PayrollLaborCost.layer)),
)

/**
 * 다른 컨텍스트에 여는 서비스(`payroll.public.ts`)입니다. 지급일 구간의 급여대장 마감 현황과 월별 인건비입니다.
 *
 * `PayrollLedgerRepository`와 HR 포트(`PayrollEmployeeDirectory`)가 필요합니다. 인건비 보고서 핸들러와 같은 Layer를 쓰므로
 * `Layer.fresh`로 따로 만듭니다. 그래야 테스트가 핸들러 쪽 포트만 바꿔 끼워도 이 서비스가 먼저 만든 인스턴스를 핸들러가 물려받지 않습니다.
 */
export const PayrollPublicLive = Layer.fresh(Layer.mergeAll(PayrollLedgerSummary.layer, PayrollLaborCost.layer))

/**
 * 급여 컨텍스트가 소유한 저장소를 메모리 구현으로 채웁니다.
 *
 * 명세서 메일(`PayslipMailer`)은 Integrations에 메일 연동이 아직 없어 가짜를 함께 넣습니다. HR·Tax 포트는 넣지 않습니다.
 * `app.ts`가 `src/wiring/`의 어댑터로 채웁니다.
 */
export const PayrollMemoryStoreLive = Layer.mergeAll(
  RateTableRepository.layerMemory(),
  PayrollSettingRepository.layerMemory(),
  PayrollLedgerRepository.layerMemory(),
  PayslipRepository.layerMemory,
  SeveranceSettlementRepository.layerMemory,
  PayslipMailer.layerFake,
)

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
