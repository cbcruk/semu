/**
 * 다른 컨텍스트가 Identity & Access에서 가져다 쓰는 포트와 데모 시드 값입니다.
 *
 * 인증·인가 핵심(`Authentication`, `authorize`, `CurrentActor`, `Actor`, `Plan`)은 각 파일에서 직접 가져옵니다.
 */
export { CompanyPlans } from './access/company-plans.ts'
export { DEMO_COMPANY_IDS, DEMO_PLANS, DEMO_USER_IDS } from './demo-seed.ts'
