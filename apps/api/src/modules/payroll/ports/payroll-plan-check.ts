import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Plan } from '../../identity-access/actor.types.ts'

/**
 * 회사가 지금 구독 중인 플랜을 묻는 포트입니다. 행위자 없이 도는 정기 작업이 급여대장 플랜(`LEDGER_PLANS`)을 확인하는 데 씁니다.
 * 요청은 행위자의 플랜(`authorize`)으로 보므로 이 포트를 쓰지 않습니다. Billing이 구현한 `CompanyPlans`로 채웁니다.
 */
export class PayrollPlanCheck extends Context.Service<
  PayrollPlanCheck,
  {
    plansOf(companyId: Id<'company'>): Effect.Effect<ReadonlySet<Plan>>
  }
>()('semu/payroll/PayrollPlanCheck') {
  /** 회사별 플랜을 고정으로 둔 가짜입니다. 표에 없는 회사는 플랜이 없습니다. */
  static readonly layerMemory = (seed: Iterable<readonly [Id<'company'>, ReadonlyArray<Plan>]> = []) => {
    const plans = new Map(seed)
    return Layer.succeed(
      PayrollPlanCheck,
      PayrollPlanCheck.of({ plansOf: (companyId) => Effect.succeed(new Set(plans.get(companyId) ?? [])) }),
    )
  }
}
