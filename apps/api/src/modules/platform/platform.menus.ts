import type { MenuRule } from '../access/access.types'
import { PROMOTION_URL } from '../access/promotion'

const settingsMenu = (path: string): MenuRule => ({
  path,
  requiredPlans: [],
  applicableTo: null,
  requiresPermission: true,
  requiresTaxTerms: false,
  promotionUrl: null,
})

/**
 * Menu rules owned by the platform domain.
 *
 * Institution links, certificates, company and user settings, grants and the
 * AI assistant are available on every plan; contracts and consents need the
 * tax plan. Inviting users and editing permission roles additionally require
 * the company admin role, checked in the routes.
 */
export const PLATFORM_MENUS = {
  integrate_transaction: settingsMenu('/integrate/transaction'),
  integrate_tax: settingsMenu('/integrate/tax'),
  cert_management: settingsMenu('/manage/cert'),
  external_services: settingsMenu('/integrate/external'),
  company_management: settingsMenu('/settings/company'),
  user_management: settingsMenu('/settings/user'),
  service_payment: settingsMenu('/settings/plan'),
  contract_consent: {
    path: '/settings/contract',
    requiredPlans: ['taxation'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
  grant_recommendation: {
    path: '/recommend/grant',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
  ai_agent: {
    path: '/ai-agent',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
    requiresSystemAdmin: true,
  },
} as const satisfies Record<string, MenuRule>
