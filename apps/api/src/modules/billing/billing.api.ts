import { HttpApi } from 'effect/http-api'
import { ConsultationsApi } from './consultations/consultations.api.ts'
import { BillingMandatesApi } from './mandates/billing-mandates.api.ts'
import { PaymentsApi } from './payments/payments.api.ts'
import { ServiceContractsApi } from './service-contracts/service-contracts.api.ts'
import { SubscriptionsApi } from './subscriptions/subscriptions.api.ts'

/**
 * 구독·결제·기장 서비스 계약·상담 리드·파트너 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 그룹을 추가할 때 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙입니다.
 */
export const BillingApi = HttpApi.make('billing')
  .add(SubscriptionsApi)
  .add(PaymentsApi)
  .add(BillingMandatesApi)
  .add(ConsultationsApi)
  .add(ServiceContractsApi)
