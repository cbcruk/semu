import type { CompanyProfileRow, RepresentativeRow } from './company-profile.types'

const REGION_CODES: readonly [string, string][] = [
  ['서울', '11'],
  ['부산', '26'],
  ['대구', '27'],
  ['인천', '28'],
  ['광주', '29'],
  ['대전', '30'],
  ['울산', '31'],
  ['세종', '36'],
  ['경기', '41'],
  ['강원', '51'],
  ['충북', '43'],
  ['충남', '44'],
  ['전북', '52'],
  ['전남', '46'],
  ['경북', '47'],
  ['경남', '48'],
  ['제주', '50'],
]

/**
 * Derives the province code (시·도) from a road address, used to match grants.
 *
 * @returns The two-digit administrative code, or `null` when the address names no known province.
 */
export function regionCodeOf(address: string | null | undefined): string | null {
  if (address === null || address === undefined) return null
  const head = address.trim().slice(0, 2)
  return REGION_CODES.find(([prefix]) => head === prefix)?.[1] ?? null
}

/**
 * Serializes a company as the merged nexus and sf company object.
 *
 * Both legacy `GET /api/company/:id/` responses share this shape: `kind`
 * (`0` corporation, `1` sole proprietor) and `representative_set` come from
 * nexus, `agency` from sf, and `sf_company_id` repeats the single company ID.
 */
export function serializeCompany(company: CompanyProfileRow, representatives: readonly RepresentativeRow[]): Record<string, unknown> {
  const representativeSet = representatives.map((row) => ({ id: row.id, role: row.role, name: row.name, phone: row.phone }))
  return {
    id: company.id,
    sf_company_id: company.id,
    nexus_company_id: company.nexus_company_id,
    name: company.name,
    business_number: company.business_number,
    kind: company.business_type === 'corporate' ? 0 : 1,
    business_type: company.business_type,
    tax_plan: company.tax_plan,
    has_payroll_plan: company.has_payroll_plan === 1,
    phone: company.phone,
    business_category: company.business_category,
    zip_code: company.zip_code,
    address: company.address,
    address_detail: company.address_detail,
    payday_month: company.payday_month,
    payday_day: company.payday_day,
    corporate_number: company.corporate_number,
    corp_investment_type: company.corp_investment_type,
    corp_type: company.corp_type,
    established_on: company.established_on,
    region_code: company.region_code,
    agency: company.agency_id === null && company.agency_type === null ? null : { id: company.agency_id, type: company.agency_type },
    representative_set: representativeSet,
    representatives: representativeSet,
    created_at: company.created_at,
    updated_at: company.updated_at,
  }
}
