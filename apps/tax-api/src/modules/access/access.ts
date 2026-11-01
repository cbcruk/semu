import type { AccessContext, AccessDecision, AccessDenialReason, MenuCode } from './access.types'
import { MENU_DEFINITIONS } from './menu-codes'

/**
 * Decides whether a user may open a menu.
 *
 * Checks run in a fixed order so that the reason drives the UI:
 *
 * 1. applicability to the business type → `NOT_FOUND` (menu hidden)
 * 2. permission roles → `PERMISSION_DENIED` (menu hidden)
 * 3. plan → `ENTITLEMENT_REQUIRED` (promotion node)
 * 4. tax terms consent → `TAX_TERMS_REQUIRED` (menu shown, data blocked)
 *
 * The menu tree and the `requireMenu` middleware both call this function, so
 * what the navigation shows and what the API allows cannot drift apart.
 *
 * @example A free company opening the VAT menu
 * ```ts
 * import { decide } from './access'
 *
 * decide(
 *   {
 *     userId: 'u1',
 *     isAdmin: true,
 *     roleMenuCodes: new Set(),
 *     businessType: 'corporate',
 *     taxPlan: null,
 *     hasPayrollPlan: false,
 *     taxTermsAgreed: false,
 *   },
 *   'tax_surtax',
 * ) // { ok: false, reason: 'ENTITLEMENT_REQUIRED', promotionUrl: '/settings/plan/detail' }
 * ```
 */
export function decide(context: AccessContext, code: MenuCode): AccessDecision {
  const definition = MENU_DEFINITIONS[code]
  if (definition.applicableTo !== null && definition.applicableTo !== context.businessType) {
    return deny('NOT_FOUND')
  }
  if (definition.requiresPermission && !context.isAdmin && !context.roleMenuCodes.has(code)) {
    return deny('PERMISSION_DENIED')
  }
  if (definition.requiredPlan !== null && context.taxPlan !== definition.requiredPlan) {
    return deny('ENTITLEMENT_REQUIRED', definition.promotionUrl)
  }
  if (definition.requiresTaxTerms && context.taxPlan === 'taxation' && !context.taxTermsAgreed) {
    return deny('TAX_TERMS_REQUIRED')
  }
  return { ok: true }
}

/** Lists the menu codes a user may open. */
export function accessibleMenuCodes(context: AccessContext, codes: readonly MenuCode[]): MenuCode[] {
  return codes.filter((code) => decide(context, code).ok)
}

function deny(reason: AccessDenialReason, promotionUrl: string | null = null): AccessDecision {
  return { ok: false, reason, promotionUrl }
}
