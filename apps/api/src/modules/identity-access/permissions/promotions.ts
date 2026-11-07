import type { Plan } from '../actor.types.ts'

/** 회사를 담당하는 세무 대리인의 종류입니다. 현행 sf `agency.type`입니다. */
export type AgencyKind = 'HQ' | 'BRANCH'

const 모든플랜: ReadonlyArray<Plan> = ['TAXATION', 'PAYROLL']

/**
 * 업셀 안내를 보여 줄 플랜입니다. `/me`의 `promotions`로 내려 클라이언트가 프로모션 메뉴를 그립니다.
 *
 * 현행 클라이언트 규칙(B:77617-77630)을 옮겼습니다. 프로모션은 무료 회사(구독 없음)에게만 보이고,
 * 본사(`HQ`) 대리인이 담당하는 회사는 유료 플랜이 있어도 급여 프로모션(`pb_employment`, `pb_payroll_management`)을 봅니다.
 *
 * @example
 * ```ts
 * promotedPlans({ plans: new Set() }) // ['TAXATION', 'PAYROLL']
 * promotedPlans({ plans: new Set(['TAXATION']), agencyKind: 'HQ' }) // ['PAYROLL']
 * promotedPlans({ plans: new Set(['TAXATION']) }) // []
 * ```
 */
export function promotedPlans(input: { plans: ReadonlySet<Plan>; agencyKind?: AgencyKind | undefined }): Plan[] {
  const 빠진플랜 = 모든플랜.filter((플랜) => !input.plans.has(플랜))
  if (input.plans.size === 0) return 빠진플랜
  if (input.agencyKind === 'HQ') return 빠진플랜.filter((플랜) => 플랜 === 'PAYROLL')
  return []
}
