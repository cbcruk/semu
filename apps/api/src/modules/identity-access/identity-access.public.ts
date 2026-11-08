/**
 * 다른 컨텍스트가 Identity & Access에서 가져다 쓰는 포트와 데모 시드 값입니다.
 *
 * - `CompanyDirectory`: 회사 공개 조회. Tax의 세무 프로필과 Integrations의 회사 정보가 씁니다
 * - `CompanyPlans`: 회사 플랜 포트. Billing이 구현합니다
 * - `AgencyWorkload`: 대리인 담당 회사의 세무 일감 개수 포트. Tax가 구현합니다
 * - `BusinessStatusCheck`: 회사 등록 전 사업자 상태조회 포트. Integrations가 구현합니다
 *
 * 인증·인가 핵심(`Authentication`, `AgencyAuthentication`, `authorize`, `authorizeAgency`, `CurrentActor`, `CurrentAgent`,
 * `Actor`, `Agent`, `Plan`)은 각 파일에서 직접 가져옵니다.
 */
export { AgencyWorkload, type CompanyWorkload } from './agency/agency-workload.ts'
export { BusinessStatusCheck, type BusinessStatus } from './companies/business-status-check.ts'
export { CompanyPlans } from './access/company-plans.ts'
export { DEMO_COMPANY_IDS, DEMO_PLANS, DEMO_USER_IDS } from './demo-seed.ts'
export { CompanyDirectory, type DirectoryCompany } from './companies/company-directory.ts'
