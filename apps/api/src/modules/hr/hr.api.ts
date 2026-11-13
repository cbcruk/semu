import { HttpApi } from 'effect/http-api'
import { PayrollContractsApi } from './contracts/payroll-contracts.api.ts'
import { WorkContractsApi } from './contracts/work-contracts.api.ts'
import { EmployeeDocumentsApi } from './documents/employee-documents.api.ts'
import { EmployeesApi } from './employees/employees.api.ts'
import { FamilyMembersApi } from './family/family-members.api.ts'
import { InsuranceFilingsApi } from './insurance-filings/insurance-filings.api.ts'
import { LeavesApi } from './leaves/leaves.api.ts'
import { OrganizationApi } from './organization/organization.api.ts'
import { SocialInsuranceApi } from './social-insurance/social-insurance.api.ts'
import { TaxWithholdingApi } from './tax-withholding/tax-withholding.api.ts'

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격·소득세 공제 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 모든 그룹은 인증이 필요합니다(`.middleware(Authentication)`).
 */
export const HrApi = HttpApi.make('hr')
  .add(EmployeesApi)
  .add(LeavesApi)
  .add(WorkContractsApi)
  .add(PayrollContractsApi)
  .add(TaxWithholdingApi)
  .add(FamilyMembersApi)
  .add(SocialInsuranceApi)
  .add(OrganizationApi)
  .add(InsuranceFilingsApi)
  .add(EmployeeDocumentsApi)
