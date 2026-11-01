import type { MenuRule } from '../access/access.types'
import { PROMOTION_URL } from '../access/promotion'

/** Menu rules owned by the HR domain. */
export const HR_MENUS = {
  employee_management: {
    path: '/employee',
    requiredPlans: ['taxation'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
} as const satisfies Record<string, MenuRule>
