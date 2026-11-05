import { Layer } from 'effect'
import { demoMandates, demoPayments, demoServiceContracts, demoSubscriptions } from './billing-seed.ts'
import { ConsultationRepository } from './consultations/consultation-repository.ts'
import { ConsultationsHttpLive } from './consultations/consultations.http.ts'
import { Consultations } from './consultations/consultations.ts'
import { BillingMandateRepository } from './mandates/billing-mandate-repository.ts'
import { BillingMandatesHttpLive } from './mandates/billing-mandates.http.ts'
import { BillingMandates } from './mandates/billing-mandates.ts'
import { CmsGateway } from './mandates/cms-gateway.ts'
import { PaymentRepository } from './payments/payment-repository.ts'
import { PaymentsHttpLive } from './payments/payments.http.ts'
import { Payments } from './payments/payments.ts'
import { PublicHolidays } from './payments/public-holidays.ts'
import { ServiceContractRepository } from './service-contracts/service-contract-repository.ts'
import { ServiceContractsHttpLive } from './service-contracts/service-contracts.http.ts'
import { SubscriptionRepository } from './subscriptions/subscription-repository.ts'
import { SubscriptionCompanyPlansLive } from './subscriptions/subscription-company-plans.ts'
import { SubscriptionsHttpLive } from './subscriptions/subscriptions.http.ts'
import { Subscriptions } from './subscriptions/subscriptions.ts'

const ServicesLive = Layer.mergeAll(Subscriptions.layer, Payments.layer, BillingMandates.layer, Consultations.layer)

/**
 * 구독·결제·기장 서비스 계약·상담 리드·파트너 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다.
 *
 * 필요한 것: 저장소들, `PublicHolidays`, `CmsGateway`, 그리고 Identity & Access의 `AccessTokens`(인증 미들웨어)입니다.
 */
export const BillingHttpLive = Layer.mergeAll(
  SubscriptionsHttpLive,
  PaymentsHttpLive,
  BillingMandatesHttpLive,
  ConsultationsHttpLive,
  ServiceContractsHttpLive,
).pipe(Layer.provide(ServicesLive))

/**
 * 구독·결제·기장 서비스 계약·상담 리드·파트너 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다.
 *
 * Identity & Access의 `CompanyPlans` 포트도 여기서 구독 저장소로 구현해 넣습니다(`SubscriptionCompanyPlansLive`).
 */
export const BillingMemoryLive = SubscriptionCompanyPlansLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      PaymentRepository.layerMemory(demoPayments()),
      BillingMandateRepository.layerMemory(demoMandates()),
      ConsultationRepository.layerMemory(),
      ServiceContractRepository.layerMemory(demoServiceContracts()),
      PublicHolidays.layerMemory(),
      CmsGateway.layerFake,
      SubscriptionRepository.layerMemory(demoSubscriptions()),
    ),
  ),
)
