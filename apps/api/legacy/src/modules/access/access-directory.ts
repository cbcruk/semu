import type { DatabaseSync } from 'node:sqlite'
import type { AuthUser } from '../../app.types'
import { queryAll, queryOne } from '../../db/query'
import type { CompanyRow } from '../companies/companies.types'
import type { AccessContext } from './access.types'
import { isAgencyUser, USER_TYPE } from './user-type'

/**
 * Loads a user's access context for a company from the local replica of nexus data.
 *
 * Members get their own roles. Agency staff assigned to the company (directly,
 * or through a team member for managers) act with full menu access and skip
 * the client's consent gate. In production these tables mirror `nexus-api`;
 * this function is the seam where a nexus-backed implementation would plug in.
 *
 * @returns The context, or `null` when the user may not act for the company.
 */
export function loadAccessContext(db: DatabaseSync, user: AuthUser, company: CompanyRow, taxTermsVersion: string): AccessContext | null {
  const agency = queryOne<{ agency_type: string | null }>(db, 'SELECT agency_type FROM companies WHERE id = ?', [company.id])
  const base = {
    userId: user.id,
    businessType: company.business_type,
    taxPlan: company.tax_plan,
    hasPayrollPlan: company.has_payroll_plan === 1,
    agencyType: agency?.agency_type ?? null,
  }
  const membership = queryOne<{ role: 'admin' | 'member'; is_system_admin: 0 | 1 }>(
    db,
    'SELECT role, is_system_admin FROM memberships WHERE company_id = ? AND user_id = ?',
    [company.id, user.id],
  )
  if (membership === undefined) {
    if (!isAgencyUser(user.userType) || !isAssigned(db, user, company.id)) return null
    return { ...base, actor: 'agency', isAdmin: true, roleMenuCodes: new Set(), taxTermsAgreed: true, isSystemAdmin: false }
  }
  const roles = queryAll<{ menu_codes: string }>(
    db,
    `SELECT r.menu_codes FROM membership_roles mr
     JOIN perm_roles r ON r.company_id = mr.company_id AND r.id = mr.role_id
     WHERE mr.company_id = ? AND mr.user_id = ?`,
    [company.id, user.id],
  )
  const agreement = queryOne<{ found: number }>(
    db,
    "SELECT 1 AS found FROM term_agreements WHERE user_id = ? AND term_type = 'tax' AND version = ?",
    [user.id, taxTermsVersion],
  )
  return {
    ...base,
    actor: 'client',
    isAdmin: membership.role === 'admin',
    roleMenuCodes: new Set(roles.flatMap((role) => parseCodes(role.menu_codes))),
    taxTermsAgreed: agreement !== undefined,
    isSystemAdmin: membership.is_system_admin === 1,
  }
}

function isAssigned(db: DatabaseSync, user: AuthUser, companyId: string): boolean {
  const sql =
    user.userType === USER_TYPE.agencyManager
      ? `SELECT 1 AS found FROM agency_assignments WHERE company_id = ?
         AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE manager_id = ?))`
      : 'SELECT 1 AS found FROM agency_assignments WHERE company_id = ? AND user_id = ?'
  const params = user.userType === USER_TYPE.agencyManager ? [companyId, user.id, user.id] : [companyId, user.id]
  return queryOne<{ found: number }>(db, sql, params) !== undefined
}

function parseCodes(json: string): string[] {
  const value: unknown = JSON.parse(json)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
