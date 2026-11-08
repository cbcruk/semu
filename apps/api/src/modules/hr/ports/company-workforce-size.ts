import { Context, type Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/**
 * 회사가 상시 5명 이상의 근로자를 쓰는지 묻는 포트입니다. 사업장 규모는 Payroll 급여 설정(`underFiveEmployees`)이 소유하고
 * `src/wiring/hr-payroll.ts`가 구현합니다.
 *
 * 급여계약의 고정수당 자동계산이 이 값으로 가산 배수를 고릅니다. 5명 이상이면 근로기준법 제56조의 가산이 붙고, 4명 이하면
 * 제11조 ②와 시행령 제7조 별표 1에 제56조가 없어 붙지 않습니다(2026-11-08 결정, docs/design/hr.md 열린 질문 3).
 */
export class CompanyWorkforceSize extends Context.Service<
  CompanyWorkforceSize,
  {
    /** 상시 5명 이상인지입니다. 급여 설정을 저장한 적이 없으면 Payroll 기본값을 따라 `true`입니다. 플랜·권한은 보지 않습니다. */
    hasFiveOrMoreEmployees(companyId: Id<'company'>): Effect.Effect<boolean>
  }
>()('semu/hr/CompanyWorkforceSize') {}
