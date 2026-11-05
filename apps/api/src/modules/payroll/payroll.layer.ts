import { Layer } from 'effect'
import { LaborCostReportsHttpLive } from './labor-cost/labor-cost-reports.http.ts'
import { PayrollLaborCost } from './labor-cost/payroll-labor-cost.ts'
import { PayrollLedgerRepository } from './ledgers/payroll-ledger-repository.ts'
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
 * 급여 컨텍스트의 저장소를 메모리 구현으로, HR·Tax·메일 포트를 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다.
 *
 * HR 포트 가짜에는 데모 회사 직원 두 명이 들어 있습니다.
 */
export const PayrollMemoryLive = Layer.mergeAll(
  RateTableRepository.layerMemory(),
  PayrollSettingRepository.layerMemory(),
  PayrollLedgerRepository.layerMemory(),
  PayslipRepository.layerMemory,
  SeveranceSettlementRepository.layerMemory,
  PayrollEmployeeDirectory.layerMemory(PAYROLL_DEMO_EMPLOYEES),
  WithholdingFilingLock.layerMemory(),
  PayrollEventPublisher.layerMemory(),
  PayslipMailer.layerFake,
)
