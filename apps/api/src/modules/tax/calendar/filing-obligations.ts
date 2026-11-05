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
 * 납부 기한이 `from`–`to` 안에 드는 신고 의무를 모두 돌려줍니다.
 *
 * 부가세(예정·확정·예정고지, 간이과세자의 예정부과·확정), 원천세(매월·반기), 법인세(중간예납·확정),
 * 종합소득세(중간예납 고지·확정)를 다룹니다. 결과는 납부 기한, 세목 순입니다.
 * 납부 기한은 신고 기한과 같습니다(부가가치세법 제48조 ②·제49조 ②, 법인세법 제63조 ③·제64조 ①,
 * 소득세법 제76조 ①·제128조 ①). 분납은 납세자가 고르는 것이라 신고 건의 `paymentDue`로 덮어씁니다.
 *
 * 중간예납·예정고지·예정부과는 직전 세액이 50만원 미만이거나 신설 첫 해면 생기지 않지만(법인세법 제63조 ①,
 * 소득세법 제65조 ①·제86조, 부가가치세법 제48조 ③·제66조 ①), 프로필은 직전 세액을 모르므로 모두 만들고
 * 대리인이 해당 없는 건을 취소합니다. 연말정산은 2월분 원천세(3월 10일)에 들어가므로 따로 만들지 않습니다
 * (소득세법 제137조 ①). 신고 건은 한 번 만들면 기간을 다시 계산하지 않고, 다시 돌리면 기한만 새로 맞춥니다.
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
      ...interimDrafts(query.profile, year),
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
  if (profile.businessType === 'INDIVIDUAL' && profile.vatTaxpayerType === 'SIMPLIFIED')
    return simplifiedVatDrafts(year)
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

/**
 * 간이과세자의 부가세입니다. 1–6월은 예정부과(7월 25일, 고지)이고, 1년 확정 신고는 다음 해 1월 25일입니다
 * (부가가치세법 제66조 ①, 제67조 ①).
 */
function simplifiedVatDrafts(year: number): ObligationDraft[] {
  return [
    {
      taxType: 'VAT',
      kind: 'NOTICE',
      periodKey: `${year}-H1`,
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-06-30`,
      statutoryDue: `${year}-07-25`,
    },
    {
      taxType: 'VAT',
      kind: 'FINAL',
      periodKey: String(year),
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
      statutoryDue: `${year + 1}-01-25`,
    },
  ]
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

/**
 * 중간예납입니다.
 *
 * - 법인: 사업연도 개시일부터 6개월이 중간예납기간이고, 그 기간이 지난 날부터 2개월 안에 신고·납부합니다
 *   (법인세법 제63조 ②·③). 기간 이름은 확정 신고와 같은 사업연도 종료 연도입니다
 * - 개인: 1–6월분을 세무서가 11월 30일까지 고지·징수합니다(소득세법 제65조 ①)
 */
function interimDrafts(profile: TaxCalendarProfile, year: number): ObligationDraft[] {
  if (profile.businessType === 'INDIVIDUAL') {
    return [
      {
        taxType: 'INCOME_TAX',
        kind: 'NOTICE',
        periodKey: `${year}-H1`,
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-06-30`,
        statutoryDue: `${year}-11-30`,
      },
    ]
  }
  const firstMonth = addMonths(monthOf(year, profile.fiscalYearEndMonth), -11)
  const interimEnd = addMonths(firstMonth, 5)
  return [
    {
      taxType: 'CORPORATE_TAX',
      kind: 'INTERIM',
      periodKey: String(year),
      periodStart: `${firstMonth}-01`,
      periodEnd: lastDayOfMonth(interimEnd),
      statutoryDue: lastDayOfMonth(addMonths(interimEnd, 2)),
    },
  ]
}

function monthOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}
