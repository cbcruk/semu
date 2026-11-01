import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { CompanyProfileRow, RepresentativeRow } from './company-profile.types'

const PATCHABLE_COLUMNS = [
  'phone',
  'business_category',
  'zip_code',
  'address',
  'address_detail',
  'payday_month',
  'payday_day',
  'corporate_number',
  'corp_investment_type',
  'corp_type',
  'established_on',
  'region_code',
] as const

/** Column the settings patch may change. */
export type PatchableColumn = (typeof PATCHABLE_COLUMNS)[number]

/** Finds a company with its platform columns. */
export function findCompanyProfile(db: DatabaseSync, companyId: string): CompanyProfileRow | undefined {
  return queryOne<CompanyProfileRow>(db, 'SELECT * FROM companies WHERE id = ?', [companyId])
}

/** Finds a company by its 10-digit business number, ignoring hyphens in stored values. */
export function findCompanyByBusinessNumber(db: DatabaseSync, businessNumber: string): CompanyProfileRow | undefined {
  return queryOne<CompanyProfileRow>(db, "SELECT * FROM companies WHERE replace(business_number, '-', '') = ?", [businessNumber])
}

/** Inserts a company registered through signup. */
export function insertCompany(
  db: DatabaseSync,
  company: { id: string; name: string; businessNumber: string; businessType: 'corporate' | 'individual'; phone: string | null; agencyId: string | null; now: string },
): void {
  execute(
    db,
    `INSERT INTO companies (id, nexus_company_id, name, business_number, business_type, tax_plan, phone, agency_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [company.id, company.id, company.name, company.businessNumber, company.businessType, company.phone, company.agencyId, company.now, company.now],
  )
}

/** Updates the given settings columns. */
export function updateCompanyColumns(db: DatabaseSync, companyId: string, values: Partial<Record<PatchableColumn, SqlValue>>, now: string): void {
  const entries = Object.entries(values).filter(([column]) => (PATCHABLE_COLUMNS as readonly string[]).includes(column))
  if (entries.length === 0) return
  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  execute(db, `UPDATE companies SET ${assignments}, updated_at = ? WHERE id = ?`, [...entries.map(([, value]) => value ?? null), now, companyId])
}

/** Stores the business types read from Hometax. */
export function updateBusinessTypes(db: DatabaseSync, companyId: string, json: string, now: string): void {
  execute(db, 'UPDATE companies SET business_types = ?, updated_at = ? WHERE id = ?', [json, now, companyId])
}

/** Lists a company's representatives in display order. */
export function listRepresentatives(db: DatabaseSync, companyId: string): RepresentativeRow[] {
  return queryAll<RepresentativeRow>(db, 'SELECT * FROM company_representatives WHERE company_id = ? ORDER BY sort_order, id', [companyId])
}

/** Replaces a company's representatives. */
export function replaceRepresentatives(db: DatabaseSync, companyId: string, rows: readonly Omit<RepresentativeRow, 'company_id'>[]): void {
  execute(db, 'DELETE FROM company_representatives WHERE company_id = ?', [companyId])
  for (const row of rows) {
    execute(db, 'INSERT INTO company_representatives (company_id, id, role, name, phone, sort_order) VALUES (?, ?, ?, ?, ?, ?)', [
      companyId,
      row.id,
      row.role,
      row.name,
      row.phone,
      row.sort_order,
    ])
  }
}

/** Adds a member to a company. */
export function insertMembership(
  db: DatabaseSync,
  membership: { companyId: string; userId: string; role: 'admin' | 'member'; isSystemAdmin: boolean; invitedBy: string | null; now: string },
): void {
  execute(db, 'INSERT INTO memberships (company_id, user_id, role, is_system_admin, joined_at, invited_by) VALUES (?, ?, ?, ?, ?, ?)', [
    membership.companyId,
    membership.userId,
    membership.role,
    membership.isSystemAdmin ? 1 : 0,
    membership.now,
    membership.invitedBy,
  ])
}

/** Checks whether a user belongs to a company. */
export function isMember(db: DatabaseSync, companyId: string, userId: string): boolean {
  return queryOne<{ found: number }>(db, 'SELECT 1 AS found FROM memberships WHERE company_id = ? AND user_id = ?', [companyId, userId]) !== undefined
}
