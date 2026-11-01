import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_MENU_TREE } from '../modules/menu-tree/default-menu-tree'
import { seedBookkeepingDemo } from '../modules/bookkeeping/bookkeeping.seed'
import { seedHrDemo } from '../modules/hr/hr.seed'
import { seedPayrollDemo } from '../modules/payroll/payroll.seed'
import { seedPlatformDemo } from '../modules/platform/platform.seed'
import { execute, transaction } from './query'
import type { SeedContext } from './seed.types'

/** Fixed IDs of the demo fixtures, shared by tests and the seed script. */
export const SEED = {
  companies: { corp: 'c-corp', individual: 'c-ind', free: 'c-free' },
  users: {
    admin: 'u-admin',
    taxMember: 'u-tax',
    plainMember: 'u-member',
    individualAdmin: 'u-ind',
    freeAdmin: 'u-free',
    demo: 'u-demo',
    agent: 'u-agent',
    manager: 'u-manager',
    otherAgent: 'u-other',
  },
} as const

/**
 * Korean public holidays used for local development.
 *
 * Verify against the official announcement before relying on them; temporary
 * holidays in particular are announced at short notice.
 */
export const DEMO_HOLIDAYS: readonly [string, string, string][] = [
  ['2026-01-01', '신정', 'public'],
  ['2026-02-16', '설날 연휴', 'public'],
  ['2026-02-17', '설날', 'public'],
  ['2026-02-18', '설날 연휴', 'public'],
  ['2026-03-02', '삼일절 대체공휴일', 'substitute'],
  ['2026-05-01', '근로자의 날', 'statutory_extra'],
  ['2026-05-05', '어린이날', 'public'],
  ['2026-05-25', '부처님오신날 대체공휴일', 'substitute'],
  ['2026-06-03', '전국동시지방선거', 'public'],
  ['2026-08-17', '광복절 대체공휴일', 'substitute'],
  ['2026-09-24', '추석 연휴', 'public'],
  ['2026-09-25', '추석', 'public'],
  ['2026-09-28', '추석 대체공휴일', 'substitute'],
  ['2026-10-05', '개천절 대체공휴일', 'substitute'],
  ['2026-10-09', '한글날', 'public'],
  ['2026-12-25', '성탄절', 'public'],
  ['2027-01-01', '신정', 'public'],
]

/** Inserts demo companies, users, roles, menu trees, holidays and VAT evidence, then each domain's fixtures. */
export function seedDemoData(db: DatabaseSync, context: SeedContext & { taxTermsVersion: string }): void {
  const { now, taxTermsVersion } = context
  transaction(db, () => {
    const { companies, users } = SEED
    insertCompany(db, companies.corp, 'n-1', '주식회사 데모', '110-81-00001', 'corporate', 'taxation', now)
    insertCompany(db, companies.individual, 'n-2', '데모상점', '220-12-00002', 'individual', 'taxation', now)
    insertCompany(db, companies.free, 'n-3', '무료회사', '330-81-00003', 'corporate', null, now)

    insertUser(db, users.admin, 0, null)
    insertUser(db, users.taxMember, 0, null)
    insertUser(db, users.plainMember, 0, null)
    insertUser(db, users.individualAdmin, 0, null)
    insertUser(db, users.freeAdmin, 0, null)
    insertUser(db, users.demo, 99, null)
    insertUser(db, users.manager, 2, null)
    insertUser(db, users.agent, 1, users.manager)
    insertUser(db, users.otherAgent, 1, null)

    insertMembership(db, companies.corp, users.admin, 'admin')
    insertMembership(db, companies.corp, users.taxMember, 'member')
    insertMembership(db, companies.corp, users.plainMember, 'member')
    insertMembership(db, companies.corp, users.demo, 'admin')
    insertMembership(db, companies.individual, users.individualAdmin, 'admin')
    insertMembership(db, companies.free, users.freeAdmin, 'admin')

    execute(db, 'INSERT INTO perm_roles (id, company_id, name, menu_codes) VALUES (?, ?, ?, ?)', [
      'r-tax',
      companies.corp,
      '세무 담당',
      JSON.stringify(['tax_surtax', 'tax_withholding', 'tax_corporation', 'estimated_vat']),
    ])
    execute(db, 'INSERT INTO membership_roles (company_id, user_id, role_id) VALUES (?, ?, ?)', [companies.corp, users.taxMember, 'r-tax'])

    for (const userId of [users.admin, users.taxMember, users.plainMember, users.demo]) {
      execute(db, "INSERT INTO term_agreements (user_id, term_type, version, agreed_at) VALUES (?, 'tax', ?, ?)", [userId, taxTermsVersion, now])
    }

    execute(db, 'INSERT INTO agency_assignments (user_id, company_id) VALUES (?, ?)', [users.agent, companies.corp])
    execute(db, 'INSERT INTO agency_assignments (user_id, company_id) VALUES (?, ?)', [users.otherAgent, companies.individual])

    const tree = JSON.stringify(DEFAULT_MENU_TREE)
    execute(db, 'INSERT INTO menu_tree_versions (version, tree, is_latest, created_at) VALUES (?, ?, 1, ?)', ['latest', tree, now])
    execute(db, 'INSERT INTO menu_tree_versions (version, tree, is_latest, created_at) VALUES (?, ?, 0, ?)', ['2026.08_퇴직금정산', tree, now])

    for (const [date, name, kind] of DEMO_HOLIDAYS) {
      execute(db, 'INSERT INTO public_holidays (date, name, kind) VALUES (?, ?, ?)', [date, name, kind])
    }

    const sales: [string, string, string, number, number | null, string | null][] = [
      ['s-1', 'tax_invoice', '2026-10-05', 33_000_000, 3_000_000, null],
      ['s-2', 'card', '2026-10-12', 11_000_000, null, null],
      ['s-3', 'card', '2026-10-13', -1_100_000, null, null],
      ['s-4', 'pg', '2026-10-20', 5_500_000, 500_000, 'order-77'],
      ['s-5', 'delivery', '2026-10-20', 5_500_000, 500_000, 'order-77'],
      ['s-6', 'mall', '2026-10-22', 2_200_000, 200_000, null],
    ]
    for (const [id, source, issuedOn, total, vat, group] of sales) {
      execute(
        db,
        `INSERT INTO sales_evidence (id, company_id, source, issued_on, total_amount, supply_amount, vat_amount, dedupe_group, synced_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [id, companies.corp, source, issuedOn, total, vat, group, now],
      )
    }
    const purchases: [string, string, string, number, number, 0 | 1 | null][] = [
      ['p-1', 'tax_invoice', '2026-10-07', 10_000_000, 1_000_000, 1],
      ['p-2', 'card', '2026-10-09', 500_000, 50_000, 0],
      ['p-3', 'card', '2026-10-15', 300_000, 30_000, null],
    ]
    for (const [id, source, issuedOn, supply, vat, deductible] of purchases) {
      execute(
        db,
        `INSERT INTO purchase_evidence (id, company_id, source, issued_on, supply_amount, vat_amount, account_code, deductible, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [id, companies.corp, source, issuedOn, supply, vat, deductible, now],
      )
    }
    execute(db, "INSERT INTO scrap_requests (company_id, service, status, requested_at, finished_at) VALUES (?, 'delivery', 'timeout', ?, NULL)", [
      companies.corp,
      now,
    ])

    seedPlatformDemo(db, context)
    seedHrDemo(db, context)
    seedPayrollDemo(db, context)
    seedBookkeepingDemo(db, context)
  })
}

function insertCompany(
  db: DatabaseSync,
  id: string,
  nexusId: string,
  name: string,
  businessNumber: string,
  businessType: 'corporate' | 'individual',
  taxPlan: 'taxation' | null,
  now: string,
): void {
  execute(
    db,
    `INSERT INTO companies (id, nexus_company_id, name, business_number, business_type, tax_plan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, nexusId, name, businessNumber, businessType, taxPlan, now],
  )
}

function insertUser(db: DatabaseSync, id: string, userType: number, managerId: string | null): void {
  execute(db, 'INSERT INTO users (id, email, user_type, manager_id) VALUES (?, ?, ?, ?)', [id, `${id}@example.com`, userType, managerId])
}

function insertMembership(db: DatabaseSync, companyId: string, userId: string, role: 'admin' | 'member'): void {
  execute(db, 'INSERT INTO memberships (company_id, user_id, role) VALUES (?, ?, ?)', [companyId, userId, role])
}
