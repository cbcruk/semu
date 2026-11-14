import { Effect, Layer } from 'effect'
import { CompanyPlans } from '../modules/identity-access/identity-access.public.ts'
import { PayrollPlanCheck } from '../modules/payroll/payroll.public.ts'

/** Payroll의 `PayrollPlanCheck` 포트를 Billing이 구현한 플랜(`CompanyPlans`)으로 구현합니다. 어느 플랜이 대장을 여는지는 Payroll이 정합니다. */
export const PayrollPlanCheckFromIdentityAccess: Layer.Layer<PayrollPlanCheck, never, CompanyPlans> = Layer.effect(
  PayrollPlanCheck,
  Effect.gen(function* () {
    const plans = yield* CompanyPlans
    return PayrollPlanCheck.of({ plansOf: (companyId) => plans.plansOf(companyId) })
  }),
)
