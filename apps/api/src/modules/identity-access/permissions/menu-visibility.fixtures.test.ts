import { describe, expect, it } from 'vitest'
import { actorPermissions } from '../access/actor-permissions.ts'
import { hasPermission } from '../actor.ts'
import type { GrantedPermission, Permission, Plan } from '../actor.types.ts'
import { decideAccess } from '../authorization.ts'
import { loadRuleCases } from '../rule-fixtures.ts'
import { testActor } from '../testing.ts'
import { BASE_PERMISSIONS, LEGACY_MENU_PERMISSIONS, permissionsForLegacyMenus } from './permission-catalog.ts'
import { promotedPlans } from './promotions.ts'

/**
 * 재설계 서버는 메뉴 트리를 내리지 않습니다. 클라이언트가 `/me`의 `permissions`·`plans`·`promotions`로 메뉴를 그리고,
 * 서버는 엔드포인트마다 `authorize`로 막습니다. 이 테스트는 그 재료(현행 메뉴 코드 → 권한·플랜 표, 프로모션, 약관 게이트)가
 * 현행 메뉴 노출과 같은 답을 내는지 확인합니다. 순서는 현행 메뉴 트리처럼 권한 → 플랜입니다.
 *
 * 옮기지 않는 케이스:
 * - 사업자 형태별 신고 메뉴(법인의 종합소득세 등): 신고 종류는 Tax가 회사의 `businessType`으로 판정합니다
 * - 급여 구독 시 `employee_management` 숨김, 빈 그룹 정리: 같은 `employee` 리소스를 두 메뉴로 그리는 화면 트리 규칙입니다
 *
 * 대리인 케이스(`assigned agency staff see every applicable menu ...`)는 사업자 형태 규칙 때문에 옮기지 않았고,
 * 옮기더라도 `user_management`는 D5로 바뀝니다. 대리인은 `member:*`가 없어 숨김입니다(현행은 보임).
 */
const NOT_PORTED = new Set([
  'corporation never sees the individual income tax menu',
  'payroll subscriber never sees employee_management',
  'assigned agency staff see every applicable menu without the terms gate',
  'group with no remaining leaves is pruned',
])

/** AI 비서는 매뉴얼대로 모든 사용자에게 엽니다(바꿈). 현행 번들은 시스템 관리자만 봤습니다. */
const CHANGED: Record<string, unknown> = {
  'ai_agent hidden from an admin who is not the system admin': { node: 'visible' },
}

const PROMOTION_MENUS: Record<string, Plan> = { pb_employment: 'PAYROLL', pb_payroll_management: 'PAYROLL' }

interface LegacyInput {
  menu: string | string[]
  action?: string
  company: { taxPlan: string | null; hasPayrollPlan: boolean; agencyType: string | null }
  user: { actor: string; isAdmin: boolean; roleMenuCodes: string[]; taxTermsAgreed: boolean }
}

function node(menu: string, input: LegacyInput): Record<string, unknown> {
  const plans = new Set<Plan>([
    ...(input.company.taxPlan === 'taxation' ? (['TAXATION'] as const) : []),
    ...(input.company.hasPayrollPlan ? (['PAYROLL'] as const) : []),
  ])
  const promotions = promotedPlans({ plans, agencyKind: input.company.agencyType === 'hq' ? 'HQ' : undefined })
  const promotionPlan = PROMOTION_MENUS[menu]
  if (promotionPlan !== undefined) return { node: promotions.includes(promotionPlan) ? 'promotion' : 'hidden' }

  const permissions =
    input.user.actor === 'agency'
      ? actorPermissions({ kind: 'AGENCY' })
      : new Set<GrantedPermission>(
          input.user.isAdmin ? ['*'] : [...BASE_PERMISSIONS, ...permissionsForLegacyMenus(input.user.roleMenuCodes)],
        )
  const actor = testActor({
    kind: input.user.actor === 'agency' ? 'AGENCY' : 'CLIENT',
    permissions,
    plans,
    pendingTermCodes: input.user.taxTermsAgreed || !plans.has('TAXATION') ? [] : ['TAX_SERVICE'],
  })
  const mapping = LEGACY_MENU_PERMISSIONS[menu]
  if (mapping === undefined) throw new Error(`unmapped menu ${menu}`)
  if (mapping.openToEveryone) return { node: 'visible' }

  const read = (mapping.permissions[0] ?? '').replace(/:\*$/, ':read') as Permission
  if (!hasPermission(actor, read)) return { node: 'hidden', reason: 'PERMISSION_DENIED' }
  if (mapping.plans.length > 0 && !mapping.plans.some((plan) => plans.has(plan))) {
    return mapping.plans.some((plan) => promotions.includes(plan))
      ? { node: 'promotion', reason: 'ENTITLEMENT_REQUIRED', promotionUrl: '/settings/plan/detail' }
      : { node: 'hidden', reason: 'ENTITLEMENT_REQUIRED' }
  }
  const data = decideAccess(actor, { permission: read, plans: mapping.plans, requiresTerms: true })
  const action = input.action === 'invite' ? decideAccess(actor, { permission: 'invitation:create' }) : undefined
  return {
    node: 'visible',
    ...(data?._tag === 'TermsReagreementRequired' ? { dataAccess: { status: 403, reason: 'TAX_TERMS_REQUIRED' } } : {}),
    ...(action === undefined ? {} : { action: { status: 403, reason: 'PERMISSION_DENIED' } }),
  }
}

describe('menu-visibility fixtures', () => {
  for (const testCase of loadRuleCases('menu-visibility')) {
    it.skipIf(NOT_PORTED.has(testCase.name))(testCase.name, () => {
      const input = testCase.input as unknown as LegacyInput
      const expected = CHANGED[testCase.name] ?? testCase.expected
      if (Array.isArray(input.menu)) {
        const actual = Object.fromEntries(input.menu.map((menu) => [menu, node(menu, input)['node']]))
        expect(actual).toEqual(expected)
      } else {
        expect(node(input.menu, input)).toEqual(expected)
      }
    })
  }
})
