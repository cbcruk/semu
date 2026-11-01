import { BOOKKEEPING_MENUS } from '../bookkeeping/bookkeeping.menus'
import { HR_MENUS } from '../hr/hr.menus'
import { PAYROLL_MENUS } from '../payroll/payroll.menus'
import { PLATFORM_MENUS } from '../platform/platform.menus'
import type { TaxType } from '../tax-calendar/tax-calendar.types'
import type { MenuCode, MenuDefinition, MenuRule } from './access.types'
import { PROMOTION_URL } from './promotion'

const TAX_MENUS = {
  tax_surtax: taxMenu('/tax/surtax', null),
  tax_withholding: taxMenu('/tax/withholding-tax', null),
  tax_corporation: taxMenu('/tax/corporation-tax', 'corporate'),
  tax_aggr_income: taxMenu('/tax/aggr-income-tax', 'individual'),
  estimated_vat: {
    path: '/reports/estimated-vat',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
  today: {
    path: '/today',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
} as const satisfies Record<string, MenuRule>

/** Menu rules of every domain, keyed by menu code. Each domain owns its entries in `<domain>.menus.ts`. */
export const MENU_RULES = { ...TAX_MENUS, ...PLATFORM_MENUS, ...HR_MENUS, ...PAYROLL_MENUS, ...BOOKKEEPING_MENUS }

/** Access rules for every menu code. */
export const MENU_DEFINITIONS = Object.fromEntries(
  Object.entries(MENU_RULES).map(([code, rule]) => [code, { ...rule, code }]),
) as Record<MenuCode, MenuDefinition>

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

function taxMenu(path: string, applicableTo: MenuRule['applicableTo']): MenuRule {
  return {
    path,
    requiredPlans: ['taxation'],
    applicableTo,
    requiresPermission: true,
    requiresTaxTerms: true,
    promotionUrl: PROMOTION_URL,
  }
}
