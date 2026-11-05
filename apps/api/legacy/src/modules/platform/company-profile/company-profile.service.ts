import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { isPlainDate } from '../../../lib/plain-date'
import { isValidCorporateNumber, newId } from '../platform.utils'
import {
  findCompanyByBusinessNumber,
  findCompanyProfile,
  insertCompany,
  insertMembership,
  listRepresentatives,
  type PatchableColumn,
  replaceRepresentatives,
  updateCompanyColumns,
} from './company-profile.repository'
import type { CompanyProfileRow, CompanySettingsPatch, NewCompanyInput } from './company-profile.types'
import { regionCodeOf, serializeCompany } from './company-profile.utils'

/** Loads a company with its platform columns. */
export function requireCompanyProfile(deps: ServiceDeps, companyId: string): CompanyProfileRow {
  const company = findCompanyProfile(deps.db, companyId)
  if (company === undefined) throw notFound('Company')
  return company
}

/** Returns the merged company object of `GET /api/company/:id/` and the settings screen. */
export function getCompanyDetail(deps: ServiceDeps, companyId: string): Record<string, unknown> {
  return serializeCompany(requireCompanyProfile(deps, companyId), listRepresentatives(deps.db, companyId))
}

/**
 * Registers a company and makes its creator the admin and system admin.
 *
 * New companies start free: no subscription rows, `tax_plan` `NULL`.
 * Must run inside the caller's transaction when combined with other writes.
 *
 * @throws {DomainError} `CONFLICT` when the business number is already registered.
 */
export function registerCompany(deps: ServiceDeps, input: NewCompanyInput): CompanyProfileRow {
  if (findCompanyByBusinessNumber(deps.db, input.businessNumber) !== undefined) {
    throw new DomainError('CONFLICT', 'A company with this business number is already registered.')
  }
  const now = deps.clock.now()
  const id = newId('c')
  insertCompany(deps.db, {
    id,
    name: input.name,
    businessNumber: input.businessNumber,
    businessType: input.businessType,
    phone: input.phone,
    agencyId: input.agencyId ?? null,
    now,
  })
  insertMembership(deps.db, { companyId: id, userId: input.createdBy, role: 'admin', isSystemAdmin: true, invitedBy: null, now })
  if (input.representativeName !== null) {
    replaceRepresentatives(deps.db, id, [{ id: newId('rep'), role: 'boss', name: input.representativeName, phone: input.phone, sort_order: 0 }])
  }
  return requireCompanyProfile(deps, id)
}

/**
 * Saves company and representative settings in one transaction.
 *
 * The name and business number are fixed at registration and are ignored here.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for invalid corporate numbers or dates.
 */
export function updateCompanySettings(deps: ServiceDeps, companyId: string, patch: CompanySettingsPatch): Record<string, unknown> {
  requireCompanyProfile(deps, companyId)
  if (patch.corporate_number !== undefined && patch.corporate_number !== null && !isValidCorporateNumber(patch.corporate_number)) {
    throw invalidField('corporate_number', 'Enter a valid 13-digit corporate registration number.')
  }
  if (patch.established_on !== undefined && patch.established_on !== null && !isPlainDate(patch.established_on)) {
    throw invalidField('established_on', 'Expected a YYYY-MM-DD date.')
  }
  const { representatives, ...columns } = patch
  const values: Partial<Record<PatchableColumn, string | number | null>> = {}
  for (const [column, value] of Object.entries(columns)) {
    if (value !== undefined) values[column as PatchableColumn] = column === 'corporate_number' && typeof value === 'string' ? value.replace(/-/g, '') : value
  }
  if (patch.address !== undefined) values.region_code = regionCodeOf(patch.address)
  transaction(deps.db, () => {
    updateCompanyColumns(deps.db, companyId, values, deps.clock.now())
    if (representatives !== undefined) {
      replaceRepresentatives(
        deps.db,
        companyId,
        representatives.map((row, index) => ({ id: newId('rep'), role: row.role, name: row.name, phone: row.phone ?? null, sort_order: index })),
      )
    }
  })
  return getCompanyDetail(deps, companyId)
}
