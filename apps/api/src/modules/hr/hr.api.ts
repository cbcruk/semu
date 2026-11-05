import { HttpApi } from 'effect/http-api'
import { WorkContractsApi } from './contracts/work-contracts.api.ts'
import { EmployeesApi } from './employees/employees.api.ts'
import { LeavesApi } from './leaves/leaves.api.ts'
import { OrganizationApi } from './organization/organization.api.ts'
import { SocialInsuranceApi } from './social-insurance/social-insurance.api.ts'

/**
 * 직원·조직·근로/급여계약·휴직·퇴직·4대보험 자격 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 모든 그룹은 인증이 필요합니다(`.middleware(Authentication)`).
 */
export const HrApi = HttpApi.make('hr')
  .add(EmployeesApi)
  .add(LeavesApi)
  .add(WorkContractsApi)
  .add(SocialInsuranceApi)
  .add(OrganizationApi)
