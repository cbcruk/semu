import type { CalendarCompany } from '../tax-calendar/tax-calendar.types'
import type { CompanyRow } from './companies.types'

/** Extracts the settings the tax calendar needs from a company row. */
export function toCalendarCompany(company: CompanyRow): CalendarCompany {
  return {
    businessType: company.business_type,
    fiscalYearEndMonth: company.fiscal_year_end_month,
    withholdingSemiannual: company.withholding_semiannual === 1,
    vatPreliminaryMode: company.vat_preliminary_mode,
    sincereFilingTarget: company.sincere_filing_target === 1,
  }
}

/** Checks whether a company has neither a tax nor a payroll plan. */
export function isFreeCompany(company: CompanyRow): boolean {
  return company.tax_plan === null && company.has_payroll_plan === 0
}
