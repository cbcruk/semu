import type { MenuRule } from '../access/access.types'
import { PROMOTION_URL } from '../access/promotion'

/**
 * Menu rules owned by the payroll domain (spec 1.1).
 *
 * - `payroll_settlement` (급여 정산, BPO): payroll subscription.
 * - `payroll_management` (급여 관리, legacy cards): tax bookkeeping customers.
 * - `payroll_setting` (설정 > 급여 설정): payroll subscription.
 * - `salary_calculator` (급여 계산기): free for everyone.
 *
 * Codes are proposals; the live menu tree's codes for these leaves are not in
 * the entry bundle (only the promotion codes `pb_payroll_management` and
 * `pb_employment` are).
 */
export const PAYROLL_MENUS = {
  payroll_settlement: {
    path: '/payroll-settlement',
    requiredPlans: ['payroll'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
  payroll_management: {
    path: '/company/payroll',
    requiredPlans: ['taxation'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
  payroll_setting: {
    path: '/payroll-setting',
    requiredPlans: ['payroll'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
  salary_calculator: {
    path: '/salary-calculator',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
} as const satisfies Record<string, MenuRule>
