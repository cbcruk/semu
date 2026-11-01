import type { PlainDate } from '../../lib/plain-date.types'

/** Tax types, named after the legacy `reportEntryPoint` values. */
export type TaxType = 'surtax' | 'withholding_tax' | 'corporation_tax' | 'aggr_income_tax'

/** The filing cadence or variant of a tax filing. */
export type FilingKind = 'preliminary' | 'final' | 'notice' | 'monthly' | 'semiannual' | 'annual'

/** Legal form of a business, which decides corporation vs. aggregate income tax. */
export type BusinessType = 'corporate' | 'individual'

/** Company settings that change which filings exist and when they are due. */
export interface CalendarCompany {
  businessType: BusinessType
  fiscalYearEndMonth: number
  withholdingSemiannual: boolean
  vatPreliminaryMode: 'filing' | 'notice'
  sincereFilingTarget: boolean
}

/** Input to {@linkcode resolveFilingPeriods}. */
export interface CalendarInput {
  company: CalendarCompany
  /** Inclusive lower bound on the payment due date. */
  from: PlainDate
  /** Inclusive upper bound on the payment due date. */
  to: PlainDate
  /** Dates on which deadlines roll over to the next day, besides weekends. */
  holidays: ReadonlySet<PlainDate>
}

/** One filing obligation with its period and deadlines. */
export interface FilingPeriod {
  taxType: TaxType
  kind: FilingKind
  /** Natural key, unique per company and tax type, e.g. `2026-2-final`. */
  taxPeriodKey: string
  year: number
  quarter: number | null
  periodStart: PlainDate
  periodEnd: PlainDate
  /** Statutory deadline before rollover; `null` for notices, which have no return. */
  statutoryDue: PlainDate | null
  /** Filing deadline after rollover; `null` for notices. */
  dueDate: PlainDate | null
  /** Payment deadline after rollover. */
  paymentDue: PlainDate
}
