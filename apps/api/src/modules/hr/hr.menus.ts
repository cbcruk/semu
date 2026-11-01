import type { MenuRule } from '../access/access.types'
import { PROMOTION_URL } from '../access/promotion'

const payrollMenu = (path: string): MenuRule => ({
  path,
  requiredPlans: ['payroll'],
  applicableTo: null,
  requiresPermission: true,
  requiresTaxTerms: false,
  promotionUrl: PROMOTION_URL,
})

/**
 * Menu rules owned by the HR domain.
 *
 * - `employee_management`: the legacy 직원 관리 report app for tax bookkeeping customers, hidden from payroll customers by the menu tree.
 * - `employment_employee`, `employment_e_sign`, `employment_certificate`, `settings_e_sign`: payroll-plan screens (구성원 정보, 전자서명, 제증명 발급, 전자서명·제증명 관리).
 * - `document_form`: 서식 모음, open to every company.
 */
export const HR_MENUS = {
  employee_management: {
    path: '/employment',
    requiredPlans: ['taxation'],
    applicableTo: null,
    requiresPermission: true,
    requiresTaxTerms: false,
    promotionUrl: PROMOTION_URL,
  },
  employment_employee: payrollMenu('/employee'),
  employment_e_sign: payrollMenu('/e-signature'),
  employment_certificate: payrollMenu('/certificate-issuance'),
  settings_e_sign: payrollMenu('/e-signature-setting/e-signature-templates'),
  document_form: {
    path: '/document/document-form-list',
    requiredPlans: [],
    applicableTo: null,
    requiresPermission: false,
    requiresTaxTerms: false,
    promotionUrl: null,
  },
} as const satisfies Record<string, MenuRule>
