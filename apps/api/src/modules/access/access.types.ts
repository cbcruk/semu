import type { BusinessType } from '../tax-calendar/tax-calendar.types'
import type { MENU_RULES } from './menu-codes'

/** Menu codes known to the API, collected from every domain's menu rules. */
export type MenuCode = keyof typeof MENU_RULES

/** Rules that decide who may open a menu, keyed by menu code in each domain's `*.menus.ts`. */
export interface MenuRule {
  path: string
  /** Plans that unlock the menu; any one is enough. Empty when the menu is free. */
  requiredPlans: readonly Plan[]
  /** Business type the menu applies to, or `null` for both. */
  applicableTo: BusinessType | null
  /** Whether non-admin users need the code in one of their permission roles. */
  requiresPermission: boolean
  /** Whether taxation customers must have agreed to the tax terms. */
  requiresTaxTerms: boolean
  /** Upsell page shown when the plan is missing. */
  promotionUrl: string | null
  /** Whether only the company's system admin may open the menu, regardless of roles. */
  requiresSystemAdmin?: boolean
}

/** A {@linkcode MenuRule} together with its code. */
export interface MenuDefinition extends MenuRule {
  code: MenuCode
}

/** A paid subscription a company can hold. */
export type Plan = 'taxation' | 'payroll'

/** Whether the caller acts as the company's own user or as assigned agency staff. */
export type Actor = 'client' | 'agency'

/** Everything {@linkcode decide} needs to know about the user and company. */
export interface AccessContext {
  userId: string
  /** `agency` for assigned tax agency staff, who see every menu and skip the client consent gate. */
  actor: Actor
  isAdmin: boolean
  roleMenuCodes: ReadonlySet<string>
  businessType: BusinessType
  taxPlan: 'taxation' | null
  hasPayrollPlan: boolean
  taxTermsAgreed: boolean
  /** Whether the member is the company's system admin (owner account); agency staff never are. */
  isSystemAdmin?: boolean
  /** Type of the tax agency serving the company, such as `hq`, or `null` when none. */
  agencyType?: string | null
}

/** Why access was denied, in the order checks are made. */
export type AccessDenialReason = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'ENTITLEMENT_REQUIRED' | 'TAX_TERMS_REQUIRED'

/** The outcome of an access check. */
export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: AccessDenialReason; promotionUrl: string | null }

/** Numeric user types from the legacy `UserType` enum. */
export type UserType = 0 | 1 | 2 | 3 | 4 | 51 | 99
