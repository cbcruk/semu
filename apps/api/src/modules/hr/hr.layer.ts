import { Layer } from 'effect'
import { PayrollContractRepository } from './contracts/payroll-contract.ts'
import { PayrollContracts } from './contracts/payroll-contracts.ts'
import { PayrollContractsHttpLive } from './contracts/payroll-contracts.http.ts'
import { WorkContractRepository } from './contracts/work-contract.ts'
import { WorkContracts } from './contracts/work-contracts.ts'
import { WorkContractsHttpLive } from './contracts/work-contracts.http.ts'
import { EmployeeRepository } from './employees/employee-repository.ts'
import { Employees } from './employees/employees.ts'
import { EmployeesHttpLive } from './employees/employees.http.ts'
import {
  DEMO_EMPLOYEES,
  DEMO_ORGANIZATION,
  DEMO_PAYROLL_CONTRACTS,
  DEMO_TAX_WITHHOLDING,
  DEMO_WORK_CONTRACTS,
} from './hr-demo-seed.ts'
import { HrDirectoryLive } from './hr.public.ts'
import { InsuranceFilingRepository } from './insurance-filings/insurance-filing-repository.ts'
import { LeaveRepository } from './leaves/leave.ts'
import { Leaves } from './leaves/leaves.ts'
import { LeavesHttpLive } from './leaves/leaves.http.ts'
import { Organization } from './organization/organization-service.ts'
import { OrganizationHttpLive } from './organization/organization.http.ts'
import { OrganizationRepository } from './organization/organization.ts'
import { PersonalDataAccessLog } from './shared/personal-data-access-log.ts'
import { PersonalDataCipher } from './shared/personal-data-cipher.ts'
import { SocialInsuranceHttpLive } from './social-insurance/social-insurance.http.ts'
import { TaxWithholdingRepository } from './tax-withholding/tax-withholding.ts'
import { TaxWithholdingSettings } from './tax-withholding/tax-withholding-service.ts'
import { TaxWithholdingHttpLive } from './tax-withholding/tax-withholding.http.ts'

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 핸들러 전체입니다.
 *
 * 필요한 것: `EmployeeRepository`, `LeaveRepository`, `WorkContractRepository`, `PayrollContractRepository`,
 * `TaxWithholdingRepository`, `OrganizationRepository`, `InsuranceFilingRepository`, `PersonalDataCipher`, `PersonalDataAccessLog`.
 */
export const HrHttpLive = Layer.mergeAll(
  EmployeesHttpLive,
  LeavesHttpLive,
  WorkContractsHttpLive,
  PayrollContractsHttpLive,
  TaxWithholdingHttpLive,
  SocialInsuranceHttpLive,
  OrganizationHttpLive,
).pipe(
  Layer.provide(
    Layer.mergeAll(
      Employees.layer,
      Leaves.layer,
      WorkContracts.layer,
      PayrollContracts.layer,
      TaxWithholdingSettings.layer,
      Organization.layer,
    ),
  ),
)

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 저장소와 개인정보 포트를 메모리 구현과 결정적인 가짜로 채웁니다.
 *
 * 공개 조회(`HrDirectoryLive`)는 넣지 않습니다. `app.ts`가 같은 저장소 위에 만들어 Payroll 어댑터와 Documents에 넘깁니다.
 */
export const HrMemoryStoreLive = Layer.mergeAll(
  EmployeeRepository.layerMemory(DEMO_EMPLOYEES),
  LeaveRepository.layerMemory(),
  WorkContractRepository.layerMemory(DEMO_WORK_CONTRACTS),
  PayrollContractRepository.layerMemory(DEMO_PAYROLL_CONTRACTS),
  TaxWithholdingRepository.layerMemory(DEMO_TAX_WITHHOLDING),
  OrganizationRepository.layerMemory(DEMO_ORGANIZATION),
  InsuranceFilingRepository.layerMemory(),
  PersonalDataCipher.layerFake,
  PersonalDataAccessLog.layerMemory,
)

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다.
 *
 * 다른 컨텍스트가 쓰는 `HrDirectory`도 같은 메모리 저장소 위에 만들어 내보냅니다. 데모 회사(`DEMO_COMPANY_ID`) 데이터가 들어 있습니다.
 */
export const HrMemoryLive = HrDirectoryLive.pipe(Layer.provideMerge(HrMemoryStoreLive))
