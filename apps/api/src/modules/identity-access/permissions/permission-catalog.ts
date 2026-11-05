import type { Permission, Plan } from '../actor.types.ts'
import type {
  LegacyMenuMapping,
  PermissionArea,
  ResourcePermissions,
  RoleTemplate,
} from './permission-catalog.types.ts'

const CRUD = ['read', 'create', 'update', 'delete'] as const

/**
 * 재설계의 권한 카탈로그입니다. 키가 리소스, 값이 그 리소스의 동작입니다.
 *
 * 다른 컨텍스트의 `authorize({ permission })` 문자열은 이 표의 `리소스:동작`이어야 합니다.
 * 리소스 이름은 ID 접두사 표(`shared/ids/ids.ts`)의 이름을 kebab-case로 씁니다.
 */
export const PERMISSION_CATALOG = {
  company: { area: 'SETTINGS', actions: ['read', 'update'] },
  member: { area: 'SETTINGS', actions: ['read', 'update', 'remove'], adminOnly: ['update', 'remove'] },
  role: { area: 'SETTINGS', actions: CRUD, adminOnly: ['create', 'update', 'delete'] },
  invitation: { area: 'SETTINGS', actions: ['read', 'create', 'cancel'], adminOnly: ['create', 'cancel'] },
  'audit-log': { area: 'SETTINGS', actions: ['read'], adminOnly: ['read'] },

  subscription: { area: 'BILLING', actions: ['read', 'manage'], agentOnly: ['manage'] },
  payment: { area: 'BILLING', actions: ['read', 'retry', 'refund'], agentOnly: ['retry', 'refund'] },
  'billing-mandate': { area: 'BILLING', actions: ['read', 'create'] },
  'service-contract': { area: 'BILLING', actions: ['read'], plans: ['TAXATION'] },
  'company-document': { area: 'BILLING', actions: ['read', 'upload'], plans: ['TAXATION'] },
  consultation: { area: 'BILLING', actions: ['create'] },

  integration: { area: 'INTEGRATIONS', actions: CRUD },
  'scrap-request': { area: 'INTEGRATIONS', actions: ['read', 'create'] },
  certificate: { area: 'INTEGRATIONS', actions: ['read', 'create', 'delete'] },
  'hometax-delegation': { area: 'INTEGRATIONS', actions: ['read', 'agree'], plans: ['TAXATION'] },
  'external-service': { area: 'INTEGRATIONS', actions: ['read', 'manage'] },
  'business-status': { area: 'INTEGRATIONS', actions: ['read'] },
  'messenger-channel': { area: 'INTEGRATIONS', actions: ['link'] },

  conversation: { area: 'ASSISTANT', actions: ['read', 'create', 'delete'] },
  grant: { area: 'ASSISTANT', actions: ['read'] },

  employee: { area: 'HR', actions: CRUD, plans: ['TAXATION', 'PAYROLL'] },
  organization: { area: 'HR', actions: ['read', 'update'], plans: ['TAXATION', 'PAYROLL'] },
  'document-form': { area: 'DOCUMENTS', actions: ['read'] },
  'esign-request': { area: 'DOCUMENTS', actions: ['read', 'create', 'send', 'cancel'], plans: ['PAYROLL'] },
  'esign-template': { area: 'DOCUMENTS', actions: CRUD, plans: ['PAYROLL'] },
  'company-seal': { area: 'DOCUMENTS', actions: ['read', 'create', 'delete'], plans: ['PAYROLL'] },
  'certificate-issuance': { area: 'DOCUMENTS', actions: ['read', 'create'], plans: ['PAYROLL'] },

  'payroll-ledger': { area: 'PAYROLL', actions: [...CRUD, 'approve'], plans: ['TAXATION', 'PAYROLL'] },
  payslip: { area: 'PAYROLL', actions: ['read', 'send'], plans: ['TAXATION', 'PAYROLL'] },
  'payroll-setting': { area: 'PAYROLL', actions: ['read', 'update'], plans: ['PAYROLL'] },
  'severance-settlement': { area: 'PAYROLL', actions: CRUD, plans: ['PAYROLL'] },
  'labor-cost-report': { area: 'PAYROLL', actions: ['read'], plans: ['TAXATION'] },
  'salary-calculation': { area: 'PAYROLL', actions: ['create'] },
  'payroll-workflow': { area: 'PAYROLL', actions: ['update'], plans: ['PAYROLL'] },
  'payroll-rate-table': { area: 'PAYROLL', actions: ['read'], plans: ['PAYROLL'] },
  'payroll-calculator': { area: 'PAYROLL', actions: ['simulate'], plans: ['PAYROLL'] },

  evidence: { area: 'BOOKKEEPING', actions: [...CRUD, 'classify'] },
  'bank-account': { area: 'BOOKKEEPING', actions: ['read', 'update'] },
  'bank-transaction': { area: 'BOOKKEEPING', actions: ['read', 'update'] },
  partner: { area: 'BOOKKEEPING', actions: CRUD },
  'tax-invoice': { area: 'BOOKKEEPING', actions: ['read', 'issue'] },
  'sales-transaction': { area: 'BOOKKEEPING', actions: CRUD },
  giro: { area: 'BOOKKEEPING', actions: ['read', 'pay'] },
  'account-title': { area: 'BOOKKEEPING', actions: ['read', 'update'] },
  'classification-rule': { area: 'BOOKKEEPING', actions: CRUD },
  'realtime-report': { area: 'BOOKKEEPING', actions: ['read'] },
  report: { area: 'BOOKKEEPING', actions: ['read'] },
  'settlement-report': { area: 'BOOKKEEPING', actions: ['read'], plans: ['TAXATION'] },

  'vat-filing': { area: 'TAX', actions: ['read', 'update', 'submit'], plans: ['TAXATION'] },
  'withholding-tax-filing': { area: 'TAX', actions: ['read', 'update', 'submit'], plans: ['TAXATION'] },
  'corporate-tax-filing': { area: 'TAX', actions: ['read', 'update', 'submit'], plans: ['TAXATION'] },
  'income-tax-filing': { area: 'TAX', actions: ['read', 'update', 'submit'], plans: ['TAXATION'] },
  filing: {
    area: 'TAX',
    actions: ['read', 'update', 'submit', 'confirm-ledger', 'pay', 'process'],
    agentOnly: ['process'],
    plans: ['TAXATION'],
  },
  'estimated-vat': { area: 'TAX', actions: ['read'] },
  'action-card': { area: 'TAX', actions: ['read', 'update'] },
} as const satisfies Record<string, ResourcePermissions>

/** 카탈로그의 리소스 이름입니다. */
export type PermissionResource = keyof typeof PERMISSION_CATALOG

/**
 * 모든 구성원이 권한 그룹 없이 갖는 권한입니다.
 *
 * 현행에서 `requiresPermission: false`였던 메뉴(오늘의 할 일, AI 비서, 지원금 추천, 서식 모음, 급여 계산기)와
 * 회사 기본 정보·상담 신청처럼 화면 공통으로 쓰는 읽기입니다.
 */
export const BASE_PERMISSIONS: ReadonlyArray<Permission> = [
  'company:read',
  'action-card:read',
  'conversation:read',
  'conversation:create',
  'conversation:delete',
  'grant:read',
  'document-form:read',
  'salary-calculation:create',
  'business-status:read',
  'messenger-channel:link',
  'consultation:create',
]

/**
 * 세무 대리인이 기본으로 갖지 않는 리소스입니다(D5). 구성원 관리(구성원·권한 그룹·초대·감사 로그)와 AI 비서(대화·지원금 추천)입니다.
 *
 * 구성원 관리는 고객 회사의 내부 통제라 대리인 업무가 아니고, AI 비서는 고객용 기능이라 현행도 대리인에게 열지 않았습니다.
 */
export const AGENT_EXCLUDED_RESOURCES: ReadonlyArray<PermissionResource> = [
  'member',
  'role',
  'invitation',
  'audit-log',
  'conversation',
  'grant',
]

/**
 * 세무 대리인의 기본 권한입니다(D5). 회사 범위의 대리인 행위자와 대리인 범위 토큰(`authorizeAgency`)이 같은 이 표를 봅니다.
 *
 * 고객 업무 리소스는 `resource:*`로, 대리인 전용 동작은 하나씩 적습니다. 와일드카드는 대리인 전용 동작을 덮지 않으므로
 * `filing:*`가 있어도 `filing:process`를 따로 적어야 합니다. 카탈로그에 리소스를 더하면 이 표에도 자동으로 들어가니
 * 대리인에게 주지 않을 리소스는 {@link AGENT_EXCLUDED_RESOURCES}에 넣습니다.
 *
 * @example
 * ```ts
 * AGENT_PERMISSIONS.includes('filing:process') // true
 * AGENT_PERMISSIONS.includes('member:*') // false
 * ```
 */
export const AGENT_PERMISSIONS: ReadonlyArray<Permission> = (
  Object.entries(PERMISSION_CATALOG) as Array<[PermissionResource, ResourcePermissions]>
).flatMap(([resource, entry]): Permission[] =>
  AGENT_EXCLUDED_RESOURCES.includes(resource)
    ? []
    : [`${resource}:*`, ...(entry.agentOnly ?? []).map((action): Permission => `${resource}:${action}`)],
)

/** 권한 그룹 템플릿입니다. 회사는 템플릿을 복사해 권한 그룹을 만듭니다. */
export const ROLE_TEMPLATES: ReadonlyArray<RoleTemplate> = [
  {
    code: 'BOOKKEEPING',
    name: '경리',
    permissions: [
      'evidence:*',
      'bank-account:*',
      'bank-transaction:*',
      'partner:*',
      'tax-invoice:*',
      'sales-transaction:*',
      'giro:*',
      'realtime-report:read',
      'integration:read',
      'scrap-request:*',
    ],
  },
  { code: 'HR', name: '인사', permissions: ['employee:*', 'esign-request:*', 'certificate-issuance:*'] },
  {
    code: 'PAYROLL',
    name: '급여',
    permissions: ['payroll-ledger:*', 'payslip:*', 'severance-settlement:*', 'labor-cost-report:read'],
  },
  {
    code: 'TAX',
    name: '세무',
    permissions: [
      'vat-filing:*',
      'withholding-tax-filing:*',
      'corporate-tax-filing:*',
      'income-tax-filing:*',
      'estimated-vat:read',
      'settlement-report:read',
    ],
  },
  { code: 'SETTINGS', name: '설정', permissions: ['company:update', 'member:read', 'role:read', 'invitation:read'] },
]

/**
 * 현행 메뉴 코드를 재설계 권한으로 옮기는 표입니다.
 *
 * 현행 권한 그룹(`perm_roles.menu_codes`)을 옮길 때와, 현행 메뉴 이름으로 권한을 찾을 때 씁니다.
 * 메뉴 노출은 클라이언트가 `/me`의 `permissions`로 정합니다.
 */
export const LEGACY_MENU_PERMISSIONS: Readonly<Record<string, LegacyMenuMapping>> = {
  today: open(['action-card:read']),
  ai_agent: open(['conversation:read', 'conversation:create', 'conversation:delete']),
  grant_recommendation: open(['grant:read']),
  document_form: open(['document-form:read']),
  salary_calculator: open(['salary-calculation:create']),
  realtime_profit_loss: menu(['realtime-report:read']),
  realtime_cash: menu(['realtime-report:read']),
  estimated_vat: menu(['estimated-vat:read']),
  report_profit_loss: menu(['settlement-report:read'], ['TAXATION']),
  settlement_reports_profit_loss_cost_details: menu(['settlement-report:read'], ['TAXATION']),
  settlement_reports_profit_loss_labor_cost: menu(['labor-cost-report:read'], ['TAXATION']),
  report_cash: menu(['settlement-report:read'], ['TAXATION']),
  report_financial_position: menu(['settlement-report:read'], ['TAXATION']),
  bookkeeping_sales_evidence: menu(['evidence:*']),
  bookkeeping_purchase_evidence: menu(['evidence:*']),
  bookkeeping_bank_transactions: menu(['bank-transaction:*']),
  bookkeeping_bank_accounts: menu(['bank-account:*']),
  bookkeeping_partners: menu(['partner:*']),
  bookkeeping_sales_transactions: menu(['tax-invoice:*', 'sales-transaction:*']),
  bookkeeping_tax_payment: menu(['giro:*']),
  settings_accounting: menu(['account-title:*', 'classification-rule:*']),
  employee_management: menu(['employee:*'], ['TAXATION']),
  employment_employee: menu(['employee:*'], ['PAYROLL']),
  employment_e_sign: menu(['esign-request:*'], ['PAYROLL']),
  employment_certificate: menu(['certificate-issuance:*'], ['PAYROLL']),
  settings_e_sign: menu(['esign-template:*', 'company-seal:*'], ['PAYROLL']),
  payroll_settlement: menu(['payroll-ledger:*', 'payslip:*'], ['PAYROLL']),
  payroll_management: menu(['payroll-ledger:*', 'payslip:*'], ['TAXATION']),
  payroll_setting: menu(['payroll-setting:*'], ['PAYROLL']),
  severance_pay_settlement: menu(['severance-settlement:*'], ['PAYROLL']),
  tax_surtax: menu(['vat-filing:*'], ['TAXATION']),
  tax_withholding: menu(['withholding-tax-filing:*'], ['TAXATION']),
  tax_corporation: menu(['corporate-tax-filing:*'], ['TAXATION']),
  tax_aggr_income: menu(['income-tax-filing:*'], ['TAXATION']),
  company_management: menu(['company:read', 'company:update']),
  user_management: menu(['member:read', 'role:read', 'invitation:read']),
  integrate_tax: menu(['integration:*', 'scrap-request:*']),
  integrate_transaction: menu(['integration:*', 'scrap-request:*']),
  cert_management: menu(['certificate:*']),
  external_services: menu(['external-service:*']),
  service_payment: menu(['subscription:read', 'payment:read', 'billing-mandate:*']),
  contract_consent: menu(['service-contract:read', 'company-document:*', 'hometax-delegation:*'], ['TAXATION']),
}

/**
 * 권한 그룹에 넣을 수 있는 권한인지입니다.
 *
 * `*`, 카탈로그에 없는 리소스·동작, 관리자 전용 동작, 대리인 전용 동작은 넣을 수 없습니다. 관리자 전용 동작이 있는 리소스는
 * `resource:*`로도 줄 수 없습니다. 현행 매뉴얼의 "일반 사용자는 초대·권한 생성 불가"를 권한으로 표현한 것입니다.
 * 대리인 전용 동작이 있는 리소스는 `resource:*`로 줄 수 있습니다. 와일드카드가 대리인 전용 동작을 덮지 않기 때문입니다.
 *
 * @example
 * ```ts
 * isGrantable('employee:*') // true
 * isGrantable('member:*') // false, member:update는 관리자 전용
 * isGrantable('filing:process') // false, 대리인 전용
 * ```
 */
export function isGrantable(permission: string): boolean {
  const [resource, action, ...rest] = permission.split(':')
  if (resource === undefined || action === undefined || rest.length > 0) return false
  const entry = catalogEntry(resource)
  if (entry === undefined) return false
  const adminOnly: ReadonlyArray<string> = entry.adminOnly ?? []
  if (action === '*') return adminOnly.length === 0
  const agentOnly: ReadonlyArray<string> = entry.agentOnly ?? []
  return entry.actions.includes(action) && !adminOnly.includes(action) && !agentOnly.includes(action)
}

/**
 * 세무 대리인만 가질 수 있는 권한인지입니다. 이런 권한은 `*`·`resource:*`로 덮이지 않고 정확히 같은 문자열로만 갖습니다.
 *
 * 그래서 고객 관리자의 `*`는 대리인 전용 동작을 포함하지 않고, 컨텍스트마다 `actor.kind`를 따로 볼 필요가 없습니다.
 *
 * @example
 * ```ts
 * isAgentOnly('filing:process') // true
 * isAgentOnly('filing:read') // false
 * ```
 */
export function isAgentOnly(permission: string): boolean {
  const [resource, action] = permission.split(':')
  if (resource === undefined || action === undefined) return false
  const agentOnly: ReadonlyArray<string> = catalogEntry(resource)?.agentOnly ?? []
  return agentOnly.includes(action)
}

/** 권한이 속한 영역입니다. 카탈로그에 없는 리소스면 `undefined`입니다. */
export function permissionArea(permission: string): PermissionArea | undefined {
  return catalogEntry(permission.split(':')[0] ?? '')?.area
}

/** 현행 메뉴 코드 목록을 재설계 권한으로 바꿉니다. 모르는 코드는 건너뛰고, 모두에게 열린 메뉴는 기본 권한이라 넣지 않습니다. */
export function permissionsForLegacyMenus(codes: Iterable<string>): Permission[] {
  const permissions = new Set<Permission>()
  for (const code of codes) {
    const mapping = LEGACY_MENU_PERMISSIONS[code]
    if (mapping === undefined || mapping.openToEveryone) continue
    for (const permission of mapping.permissions) permissions.add(permission as Permission)
  }
  return [...permissions].sort()
}

/** 권한 그룹 화면에 보여 줄 권한 하나입니다. */
export interface GrantablePermission {
  permission: string
  area: PermissionArea
  requiredPlans: ReadonlyArray<Plan>
}

/** 권한 그룹에 넣을 수 있는 권한 전체입니다. 카탈로그 순서를 따릅니다. */
export function grantablePermissions(): GrantablePermission[] {
  return Object.entries(PERMISSION_CATALOG as Record<string, ResourcePermissions>).flatMap(([resource, entry]) =>
    entry.actions
      .map((action) => `${resource}:${action}`)
      .filter(isGrantable)
      .map((permission) => ({ permission, area: entry.area, requiredPlans: entry.plans ?? [] })),
  )
}

function catalogEntry(resource: string): ResourcePermissions | undefined {
  return Object.hasOwn(PERMISSION_CATALOG, resource)
    ? (PERMISSION_CATALOG as Record<string, ResourcePermissions>)[resource]
    : undefined
}

function menu(permissions: ReadonlyArray<string>, plans: ReadonlyArray<Plan> = []): LegacyMenuMapping {
  return { permissions, plans, openToEveryone: false }
}

function open(permissions: ReadonlyArray<string>): LegacyMenuMapping {
  return { permissions, plans: [], openToEveryone: true }
}
