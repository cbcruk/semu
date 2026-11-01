import { addMonths, fromParts, lastDayOfMonth, quarterOfMonth } from '../../lib/plain-date'
import type { PlainDate } from '../../lib/plain-date.types'
import type { CalendarCompany, CalendarInput, FilingKind, FilingPeriod, TaxType } from './tax-calendar.types'
import { applyDeadlineRollover } from './tax-calendar.utils'

interface PeriodDraft {
  taxType: TaxType
  kind: FilingKind
  taxPeriodKey: string
  year: number
  quarter: number | null
  periodStart: PlainDate
  periodEnd: PlainDate
  statutoryDue: PlainDate
}

/**
 * Lists every filing obligation whose payment deadline falls within a date range.
 *
 * Covers general-taxpayer VAT (preliminary, final and notices), monthly or
 * semiannual withholding tax, corporation tax and aggregate income tax.
 * Periods are stored once created; recomputing only refreshes deadlines.
 *
 * @example Upcoming filings for a December year-end corporation
 * ```ts
 * import { resolveFilingPeriods } from './tax-calendar'
 *
 * resolveFilingPeriods({
 *   company: {
 *     businessType: 'corporate',
 *     fiscalYearEndMonth: 12,
 *     withholdingSemiannual: false,
 *     vatPreliminaryMode: 'filing',
 *     sincereFilingTarget: false,
 *   },
 *   from: '2026-11-01' as PlainDate,
 *   to: '2027-01-31' as PlainDate,
 *   holidays: new Set(),
 * })
 * ```
 */
export function resolveFilingPeriods(input: CalendarInput): FilingPeriod[] {
  const firstYear = Number(input.from.slice(0, 4)) - 2
  const lastYear = Number(input.to.slice(0, 4)) + 1
  const drafts: PeriodDraft[] = []
  for (let year = firstYear; year <= lastYear; year++) {
    drafts.push(
      ...surtaxDrafts(input.company, year),
      ...withholdingDrafts(input.company, year),
      ...incomeDrafts(input.company, year),
    )
  }
  return drafts
    .map((draft) => finalize(draft, input.holidays))
    .filter((period) => period.paymentDue >= input.from && period.paymentDue <= input.to)
    .sort((a, b) => a.paymentDue.localeCompare(b.paymentDue) || a.taxType.localeCompare(b.taxType))
}

function finalize(draft: PeriodDraft, holidays: ReadonlySet<PlainDate>): FilingPeriod {
  const rolled = applyDeadlineRollover(draft.statutoryDue, holidays)
  const isNotice = draft.kind === 'notice'
  return {
    ...draft,
    statutoryDue: isNotice ? null : draft.statutoryDue,
    dueDate: isNotice ? null : rolled,
    paymentDue: rolled,
  }
}

function surtaxDrafts(company: CalendarCompany, year: number): PeriodDraft[] {
  const isCorporateFiling = company.businessType === 'corporate' && company.vatPreliminaryMode === 'filing'
  const drafts: PeriodDraft[] = []
  for (const half of [1, 2] as const) {
    const firstMonth = half === 1 ? 1 : 7
    const preliminaryEnd = lastDayOfMonth(year, firstMonth + 2)
    drafts.push({
      taxType: 'surtax',
      kind: isCorporateFiling ? 'preliminary' : 'notice',
      taxPeriodKey: `${year}-${half}-${isCorporateFiling ? 'preliminary' : 'notice'}`,
      year,
      quarter: quarterOfMonth(firstMonth),
      periodStart: fromParts(year, firstMonth, 1),
      periodEnd: preliminaryEnd,
      statutoryDue: fromParts(year, firstMonth + 3, 25),
    })
    drafts.push({
      taxType: 'surtax',
      kind: 'final',
      taxPeriodKey: `${year}-${half}-final`,
      year,
      quarter: quarterOfMonth(firstMonth + 3),
      periodStart: fromParts(year, isCorporateFiling ? firstMonth + 3 : firstMonth, 1),
      periodEnd: lastDayOfMonth(year, firstMonth + 5),
      statutoryDue: fromParts(year, firstMonth + 6, 25),
    })
  }
  return drafts
}

function withholdingDrafts(company: CalendarCompany, year: number): PeriodDraft[] {
  if (company.withholdingSemiannual) {
    return ([1, 2] as const).map((half) => {
      const firstMonth = half === 1 ? 1 : 7
      return {
        taxType: 'withholding_tax',
        kind: 'semiannual',
        taxPeriodKey: `${year}-H${half}-semiannual`,
        year,
        quarter: half * 2,
        periodStart: fromParts(year, firstMonth, 1),
        periodEnd: lastDayOfMonth(year, firstMonth + 5),
        statutoryDue: fromParts(year, firstMonth + 6, 10),
      }
    })
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    return {
      taxType: 'withholding_tax',
      kind: 'monthly',
      taxPeriodKey: `${year}-${String(month).padStart(2, '0')}-payment`,
      year,
      quarter: quarterOfMonth(month),
      periodStart: fromParts(year, month, 1),
      periodEnd: lastDayOfMonth(year, month),
      statutoryDue: fromParts(year, month + 1, 10),
    }
  })
}

function incomeDrafts(company: CalendarCompany, year: number): PeriodDraft[] {
  if (company.businessType === 'individual') {
    return [
      {
        taxType: 'aggr_income_tax',
        kind: 'annual',
        taxPeriodKey: `${year}-annual`,
        year,
        quarter: null,
        periodStart: fromParts(year, 1, 1),
        periodEnd: fromParts(year, 12, 31),
        statutoryDue: fromParts(year + 1, company.sincereFilingTarget ? 6 : 5, company.sincereFilingTarget ? 30 : 31),
      },
    ]
  }
  const endMonth = company.fiscalYearEndMonth
  const filingMonths = company.sincereFilingTarget ? 4 : 3
  const dueMonth = addMonths(fromParts(year, endMonth, 1), filingMonths)
  return [
    {
      taxType: 'corporation_tax',
      kind: 'annual',
      taxPeriodKey: `${year}-FY`,
      year,
      quarter: null,
      periodStart: endMonth === 12 ? fromParts(year, 1, 1) : fromParts(year - 1, endMonth + 1, 1),
      periodEnd: lastDayOfMonth(year, endMonth),
      statutoryDue: lastDayOfMonth(Number(dueMonth.slice(0, 4)), Number(dueMonth.slice(5, 7))),
    },
  ]
}
