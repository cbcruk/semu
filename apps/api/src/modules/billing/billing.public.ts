/**
 * 다른 컨텍스트와 `app.ts`가 Billing에서 가져다 쓰는 것입니다.
 *
 * - `SubscriptionCompanyPlansLive`: Identity & Access의 `CompanyPlans` 포트 구현. `SubscriptionRepository`가 필요합니다
 * - 데모 시드 ID: 다른 컨텍스트의 메모리 시드가 같은 계약·결제를 가리킬 때 씁니다
 */
export { SubscriptionCompanyPlansLive } from './subscriptions/subscription-company-plans.ts'
export { SubscriptionRepository } from './subscriptions/subscription-repository.ts'
export { DEMO_MANDATE_ID, DEMO_PAYMENT_IDS, DEMO_SERVICE_CONTRACT_IDS } from './billing-seed.ts'
