import { addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type { FilingKind, TaxType } from '../tax.types.ts'
import type { FilingObligation, FilingObligationQuery, TaxCalendarProfile } from './filing-calendar.types.ts'
import { rollForwardDeadline } from './filing-deadline.ts'

interface ObligationDraft {
  taxType: TaxType
  kind: FilingKind
  periodKey: string
  periodStart: string
  periodEnd: string
  statutoryDue: string
}

/**
 * 납부 기한이 `from`–`to` 안에 드는 신고 의무를 모두 돌려줍니다. 일반과세자 기준입니다.
 *
 * 부가세(예정·확정·예정고지), 원천세(매월·반기), 법인세, 종합소득세를 다룹니다. 결과는 납부 기한, 세목 순입니다.
 * 신고 건은 한 번 만들면 기간을 다시 계산하지 않고, 다시 돌리면 기한만 새로 맞춥니다.
 *
 * @example 12월 결산 법인의 11월 일정
 * ```ts
 * resolveFilingObligations({ profile, from: '2026-11-01', to: '2026-11-30', holidays: new Set() })
 * // [{ taxType: 'WITHHOLDING_TAX', periodKey: '2026-10', dueDate: '2026-11-10', ... }]
 * ```
 */
export function resolveFilingObligations(query: FilingObligationQuery): FilingObligation[] {
  const firstYear = Number(query.from.slice(0, 4)) - 2
  const lastYear = Number(query.to.slice(0, 4)) + 1
  const drafts: ObligationDraft[] = []
  for (let year = firstYear; year <= lastYear; year++) {
    drafts.push(
      ...vatDrafts(query.profile, year),
      ...withholdingDrafts(query.profile, year),
      ...incomeDrafts(query.profile, year),
    )
  }
  return drafts
    .map((draft) => finalize(draft, query.holidays))
    .filter((obligation) => obligation.paymentDue >= query.from && obligation.paymentDue <= query.to)
    .sort((a, b) => a.paymentDue.localeCompare(b.paymentDue) || a.taxType.localeCompare(b.taxType))
}

function finalize(draft: ObligationDraft, holidays: ReadonlySet<string>): FilingObligation {
  const rolled = rollForwardDeadline(draft.statutoryDue, holidays)
  const isNotice = draft.kind === 'NOTICE'
  return {
    ...draft,
    statutoryDue: isNotice ? null : draft.statutoryDue,
    dueDate: isNotice ? null : rolled,
    paymentDue: rolled,
  }
}

function vatDrafts(profile: TaxCalendarProfile, year: number): ObligationDraft[] {
  const filesPreliminary = profile.businessType === 'CORPORATION' && profile.vatPreliminaryMode === 'FILING'
  return ([1, 2] as const).flatMap((half): ObligationDraft[] => {
    const firstMonth = monthOf(year, half === 1 ? 1 : 7)
    const preliminaryEnd = addMonths(firstMonth, 2)
    const finalStart = filesPreliminary ? addMonths(firstMonth, 3) : firstMonth
    const finalEnd = addMonths(firstMonth, 5)
    return [
      {
        taxType: 'VAT',
        kind: filesPreliminary ? 'PRELIMINARY' : 'NOTICE',
        periodKey: `${year}-H${half}`,
        periodStart: `${firstMonth}-01`,
        periodEnd: lastDayOfMonth(preliminaryEnd),
        statutoryDue: `${addMonths(preliminaryEnd, 1)}-25`,
      },
      {
        taxType: 'VAT',
        kind: 'FINAL',
        periodKey: `${year}-H${half}`,
        periodStart: `${finalStart}-01`,
        periodEnd: lastDayOfMonth(finalEnd),
        statutoryDue: `${addMonths(finalEnd, 1)}-25`,
      },
    ]
  })
}

function withholdingDrafts(profile: TaxCalendarProfile, year: number): ObligationDraft[] {
  if (profile.withholdingCycle === 'SEMIANNUAL') {
    return ([1, 2] as const).map((half) => {
      const firstMonth = monthOf(year, half === 1 ? 1 : 7)
      const lastMonth = addMonths(firstMonth, 5)
      return {
        taxType: 'WITHHOLDING_TAX',
        kind: 'SEMIANNUAL',
        periodKey: `${year}-H${half}`,
        periodStart: `${firstMonth}-01`,
        periodEnd: lastDayOfMonth(lastMonth),
        statutoryDue: `${addMonths(lastMonth, 1)}-10`,
      }
    })
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = monthOf(year, index + 1)
    return {
      taxType: 'WITHHOLDING_TAX',
      kind: 'MONTHLY',
      periodKey: month,
      periodStart: `${month}-01`,
      periodEnd: lastDayOfMonth(month),
      statutoryDue: `${addMonths(month, 1)}-10`,
    }
  })
}

function incomeDrafts(profile: TaxCalendarProfile, year: number): ObligationDraft[] {
  if (profile.businessType === 'INDIVIDUAL') {
    return [
      {
        taxType: 'INCOME_TAX',
        kind: 'ANNUAL',
        periodKey: String(year),
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        statutoryDue: profile.sincereFilingTarget ? `${year + 1}-06-30` : `${year + 1}-05-31`,
      },
    ]
  }
  const endMonth = monthOf(year, profile.fiscalYearEndMonth)
  return [
    {
      taxType: 'CORPORATE_TAX',
      kind: 'ANNUAL',
      periodKey: String(year),
      periodStart: `${addMonths(endMonth, -11)}-01`,
      periodEnd: lastDayOfMonth(endMonth),
      statutoryDue: lastDayOfMonth(addMonths(endMonth, profile.sincereFilingTarget ? 4 : 3)),
    },
  ]
}

function monthOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}
