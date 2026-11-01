import type { DatabaseSync } from 'node:sqlite'
import { queryAll, queryOne } from '../../db/query'
import type { CompanyRow } from '../companies/companies.types'
import type { AccessContext } from './access.types'

/**
 * Loads a user's access context for a company from the local replica of nexus data.
 *
 * In production these tables mirror `nexus-api`; this function is the seam
 * where a nexus-backed implementation would plug in.
 *
 * @returns The context, or `null` when the user is not a member of the company.
 */
export function loadAccessContext(
  db: DatabaseSync,
  userId: string,
  company: CompanyRow,
  taxTermsVersion: string,
): AccessContext | null {
  const membership = queryOne<{ role: 'admin' | 'member' }>(
    db,
    'SELECT role FROM memberships WHERE company_id = ? AND user_id = ?',
    [company.id, userId],
  )
  if (membership === undefined) return null
  const roles = queryAll<{ menu_codes: string }>(
    db,
    `SELECT r.menu_codes FROM membership_roles mr
     JOIN perm_roles r ON r.company_id = mr.company_id AND r.id = mr.role_id
     WHERE mr.company_id = ? AND mr.user_id = ?`,
    [company.id, userId],
  )
  const roleMenuCodes = new Set(roles.flatMap((role) => parseCodes(role.menu_codes)))
  const agreement = queryOne<{ found: number }>(
    db,
    "SELECT 1 AS found FROM term_agreements WHERE user_id = ? AND term_type = 'tax' AND version = ?",
    [userId, taxTermsVersion],
  )
  return {
    userId,
    isAdmin: membership.role === 'admin',
    roleMenuCodes,
    businessType: company.business_type,
    taxPlan: company.tax_plan,
    hasPayrollPlan: company.has_payroll_plan === 1,
    taxTermsAgreed: agreement !== undefined,
  }
}

function parseCodes(json: string): string[] {
  const value: unknown = JSON.parse(json)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
