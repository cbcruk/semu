import type { CompanyRow } from '../../companies/companies.types'

/** A company row including the columns the platform migration adds. */
export interface CompanyProfileRow extends CompanyRow {
  phone: string | null
  business_category: string | null
  zip_code: string | null
  address: string | null
  address_detail: string | null
  payday_month: 'current' | 'next' | null
  payday_day: string | null
  corporate_number: string | null
  corp_investment_type: number | null
  corp_type: number | null
  established_on: string | null
  region_code: string | null
  agency_id: string | null
  agency_type: 'hq' | 'branch' | null
  updated_at: string | null
}

/** A row of `company_representatives`. */
export interface RepresentativeRow {
  company_id: string
  id: string
  role: 'boss' | 'co_boss'
  name: string
  phone: string | null
  sort_order: number
}

/** Editable company settings; `undefined` leaves a field unchanged. */
export interface CompanySettingsPatch {
  phone?: string | undefined
  business_category?: string | undefined
  zip_code?: string | undefined
  address?: string | undefined
  address_detail?: string | null | undefined
  payday_month?: 'current' | 'next' | undefined
  payday_day?: string | undefined
  corporate_number?: string | null | undefined
  corp_investment_type?: number | null | undefined
  corp_type?: number | null | undefined
  established_on?: string | null | undefined
  representatives?: { role: 'boss' | 'co_boss'; name: string; phone?: string | null | undefined }[] | undefined
}

/** Input of company registration. */
export interface NewCompanyInput {
  name: string
  businessNumber: string
  businessType: 'corporate' | 'individual'
  phone: string | null
  representativeName: string | null
  createdBy: string
  agencyId?: string | null
}
