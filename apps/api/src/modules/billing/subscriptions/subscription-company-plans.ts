import { Effect, Layer } from 'effect'
import { CompanyPlans } from '../../identity-access/identity-access.public.ts'
import { today } from '../billing-access.ts'
import { entitledPlans } from './subscription-entitlement.ts'
import { SubscriptionRepository } from './subscription-repository.ts'

/**
 * Identity & Access의 {@link CompanyPlans} 포트를 구독으로 구현합니다. 플랜의 원본은 구독 하나입니다.
 *
 * 토큰을 발급할 때마다 오늘 날짜로 계산하므로 시작일·종료일이 지나면 다음 토큰부터 바로 반영됩니다.
 */
export const SubscriptionCompanyPlansLive = Layer.effect(
  CompanyPlans,
  Effect.gen(function* () {
    const repository = yield* SubscriptionRepository
    return CompanyPlans.of({
      plansOf: (companyId) =>
        Effect.gen(function* () {
          const rows = yield* repository.listByCompany(companyId)
          return new Set(entitledPlans(rows, yield* today))
        }),
    })
  }),
)
