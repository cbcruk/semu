import type { BusinessType } from '../tax-calendar/tax-calendar.types'

/** A row of the `companies` table. */
export interface CompanyRow {
  id: string
  nexus_company_id: string
  name: string
  business_number: string
  business_type: BusinessType
  tax_plan: 'taxation' | null
  has_payroll_plan: 0 | 1
  fiscal_year_end_month: number
  withholding_semiannual: 0 | 1
  vat_preliminary_mode: 'filing' | 'notice'
  sincere_filing_target: 0 | 1
  taxable_card_ratio_bp: number
  created_at: string
}
