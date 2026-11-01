import type { BusinessType } from '../tax-calendar/tax-calendar.types'

/** Menu codes known to the API. Tax codes follow the assumed `tax_*` naming. */
export type MenuCode =
  | 'tax_surtax'
  | 'tax_withholding'
  | 'tax_corporation'
  | 'tax_aggr_income'
  | 'estimated_vat'
  | 'today'
  | 'employee_management'

/** Rules that decide who may open a menu. */
export interface MenuDefinition {
  code: MenuCode
  path: string
  /** Plan the company must hold, or `null` when the menu is free. */
  requiredPlan: 'taxation' | null
  /** Business type the menu applies to, or `null` for both. */
  applicableTo: BusinessType | null
  /** Whether non-admin users need the code in one of their permission roles. */
  requiresPermission: boolean
  /** Whether taxation customers must have agreed to the tax terms. */
  requiresTaxTerms: boolean
  /** Upsell page shown when the plan is missing. */
  promotionUrl: string | null
}

/** Everything {@linkcode decide} needs to know about the user and company. */
export interface AccessContext {
  userId: string
  isAdmin: boolean
  roleMenuCodes: ReadonlySet<string>
  businessType: BusinessType
  taxPlan: 'taxation' | null
  hasPayrollPlan: boolean
  taxTermsAgreed: boolean
}

/** Why access was denied, in the order checks are made. */
export type AccessDenialReason = 'NOT_FOUND' | 'PERMISSION_DENIED' | 'ENTITLEMENT_REQUIRED' | 'TAX_TERMS_REQUIRED'

/** The outcome of an access check. */
export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: AccessDenialReason; promotionUrl: string | null }

/** Numeric user types from the legacy `UserType` enum. */
export type UserType = 0 | 1 | 2 | 3 | 4 | 51 | 99
