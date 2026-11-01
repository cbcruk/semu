import type { AccessContext } from './access.types'

interface ExclusionRule {
  codes: readonly string[]
  when: (context: AccessContext) => boolean
}

/**
 * Navigation rules ported from the client's `MENU_EXCLUSION_RULES`.
 *
 * They only hide nodes from the menu tree. API access stays with
 * {@linkcode decide}, because a hidden legacy menu (such as
 * `employee_management` for payroll subscribers) may still back other screens.
 */
export const MENU_EXCLUSION_RULES: readonly ExclusionRule[] = [{ codes: ['employee_management'], when: (context) => context.hasPayrollPlan }]

/** Promotion menus that HQ agency companies see even when they hold a paid plan. */
export const HQ_PROMOTION_CODES: ReadonlySet<string> = new Set(['pb_employment', 'pb_payroll_management'])

/** Lists the menu codes the exclusion rules hide for a user. */
export function excludedMenuCodes(context: AccessContext): Set<string> {
  return new Set(MENU_EXCLUSION_RULES.filter((rule) => rule.when(context)).flatMap((rule) => rule.codes))
}

/**
 * Decides whether a menu blocked only by its plan appears as a promotion node.
 *
 * Promotions are for free companies; `pb_employment` and
 * `pb_payroll_management` are also shown to companies served by an HQ agency.
 */
export function showsPromotion(context: AccessContext, code: string, isFreeCompany: boolean): boolean {
  return isFreeCompany || (context.agencyType === 'hq' && HQ_PROMOTION_CODES.has(code))
}
