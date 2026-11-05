import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Plan } from '../actor.types.ts'

/**
 * 회사가 지금 쓸 수 있는 플랜을 알려 주는 포트입니다. 인가가 `Actor.plans`를 채우는 데 씁니다.
 *
 * 구독의 원본은 Billing입니다. Billing이 이 포트를 구현한 Layer를 내보내고(`billing.public.ts`),
 * Identity & Access는 토큰을 발급할 때마다 이 포트로 플랜을 읽습니다. 현행 `companies.tax_plan` 같은 캐시 열은 두지 않습니다.
 */
export class CompanyPlans extends Context.Service<
  CompanyPlans,
  {
    plansOf(companyId: Id<'company'>): Effect.Effect<ReadonlySet<Plan>>
  }
>()('semu/identity-access/CompanyPlans') {
  /** 고정된 플랜 표입니다. Billing 없이 Identity & Access만 시험할 때 씁니다. */
  static readonly layerMemory = (seed: Iterable<readonly [Id<'company'>, ReadonlyArray<Plan>]> = []) => {
    const plans = new Map(seed)
    return Layer.succeed(
      CompanyPlans,
      CompanyPlans.of({ plansOf: (companyId) => Effect.succeed(new Set(plans.get(companyId) ?? [])) }),
    )
  }
}
