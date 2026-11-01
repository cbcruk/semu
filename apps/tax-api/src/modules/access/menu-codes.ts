import type { TaxType } from '../tax-calendar/tax-calendar.types'
import type { MenuCode, MenuDefinition } from './access.types'

const TAX_PROMOTION_URL = '/settings/plan/detail'

/** Access rules for every menu code. */
export const MENU_DEFINITIONS: Record<MenuCode, MenuDefinition> = {
  tax_surtax: taxMenu('tax_surtax', '/tax/surtax', null),
  tax_withholding: taxMenu('tax_withholding', '/tax/withholding-tax', null),
  tax_corporation: taxMenu('tax_corporation', '/tax/corporation-tax', 'corporate'),
  tax_aggr_income: taxMenu('tax_aggr_income', '/tax/aggr-income-tax', 'individual'),
  estimated_vat: {
    code: 'estimated_vat',
    path: '/reports/estimated-vat',
    requiredPlan: null,
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
  today: {
    code: 'today',
    path: '/today',
    requiredPlan: null,
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
  employee_management: {
    code: 'employee_management',
    path: '/employee',
    requiredPlan: 'taxation',
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: TAX_PROMOTION_URL,
  },
}

/** Menu code that guards each tax type. */
export const TAX_TYPE_MENU_CODE: Record<TaxType, MenuCode> = {
  surtax: 'tax_surtax',
  withholding_tax: 'tax_withholding',
  corporation_tax: 'tax_corporation',
  aggr_income_tax: 'tax_aggr_income',
}

/** URL path segment of each tax type, matching the legacy routes. */
export const TAX_TYPE_PATH_SEGMENT: Record<TaxType, string> = {
  surtax: 'surtax',
  withholding_tax: 'withholding-tax',
  corporation_tax: 'corporation-tax',
  aggr_income_tax: 'aggr-income-tax',
}

/** Every tax type, in menu order. */
export const TAX_TYPES: readonly TaxType[] = ['surtax', 'withholding_tax', 'corporation_tax', 'aggr_income_tax']

/** Resolves a URL path segment such as `withholding-tax` to its tax type. */
export function taxTypeFromPathSegment(segment: string): TaxType | undefined {
  return TAX_TYPES.find((taxType) => TAX_TYPE_PATH_SEGMENT[taxType] === segment)
}

/** Checks whether a string is a known menu code. */
export function isMenuCode(value: string): value is MenuCode {
  return Object.hasOwn(MENU_DEFINITIONS, value)
}

function taxMenu(code: MenuCode, path: string, applicableTo: MenuDefinition['applicableTo']): MenuDefinition {
  return {
    code,
    path,
    requiredPlan: 'taxation',
    applicableTo,
    requiresPermission: true,
    requiresTaxTerms: true,
    promotionUrl: TAX_PROMOTION_URL,
  }
}
