import { Effect, Layer } from 'effect'
import { TableFactory } from '../../shared/persistence/record-table.ts'
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
  DEMO_PAYROLL_ACCOUNT_NUMBER,
  demoPayrollContracts,
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
 * `TaxWithholdingRepository`, `OrganizationRepository`, `InsuranceFilingRepository`, `PersonalDataCipher`, `PersonalDataAccessLog`과
 * Payroll이 구현하는 포트 `SeveranceSettlementLookup`·`CompanyWorkforceSize`(`src/wiring/hr-payroll.ts`). 급여계약은 `CompanyWorkforceSize`로 사업장 규모를 읽습니다.
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

/** 데모 급여계약 계좌번호를 그 환경의 `PersonalDataCipher`로 암호화해 시드로 넣습니다. */
const DemoPayrollContractRepositoryLive = Layer.unwrap(
  Effect.gen(function* () {
    const accountNumberEncrypted = yield* (yield* PersonalDataCipher).encrypt(
      'accountNumber',
      DEMO_PAYROLL_ACCOUNT_NUMBER,
    )
    return PayrollContractRepository.layer(demoPayrollContracts(accountNumberEncrypted))
  }),
)

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 저장소와 개인정보 접근 기록입니다.
 * 표는 `TableFactory`(메모리 또는 SQLite)에 둡니다. 데모 회사(`DEMO_COMPANY_ID`) 데이터가 들어 있습니다.
 *
 * 개인정보 암호화(`PersonalDataCipher`)는 호출하는 쪽이 넣습니다. 서버(`app.ts`의 `SqliteLive`)는
 * `PersonalDataCipher.layerAesGcm`, 테스트와 {@link HrMemoryStoreLive}는 `PersonalDataCipher.layerFake`를 넣습니다.
 * 공개 조회(`HrDirectoryLive`)는 넣지 않습니다. `app.ts`가 같은 저장소 위에 만들어 Payroll 어댑터와 Documents에 넘깁니다.
 */
export const HrStoreLive = Layer.mergeAll(
  EmployeeRepository.layer(DEMO_EMPLOYEES),
  LeaveRepository.layer(),
  WorkContractRepository.layer(DEMO_WORK_CONTRACTS),
  DemoPayrollContractRepositoryLive,
  TaxWithholdingRepository.layer(DEMO_TAX_WITHHOLDING),
  OrganizationRepository.layer(DEMO_ORGANIZATION),
  InsuranceFilingRepository.layer(),
  PersonalDataAccessLog.layer,
)

/** {@link HrStoreLive}를 메모리 표와 가짜 암호화로 채웁니다. */
export const HrMemoryStoreLive = HrStoreLive.pipe(
  Layer.provideMerge(PersonalDataCipher.layerFake),
  Layer.provide(TableFactory.layerMemory),
)

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다.
 *
 * 다른 컨텍스트가 쓰는 `HrDirectory`도 같은 메모리 저장소 위에 만들어 내보냅니다. 데모 회사(`DEMO_COMPANY_ID`) 데이터가 들어 있습니다.
 */
export const HrMemoryLive = HrDirectoryLive.pipe(Layer.provideMerge(HrMemoryStoreLive))
