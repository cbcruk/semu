import { addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type { FilingKind, TaxType } from '../tax.types.ts'
import type { FilingObligation, FilingObligationQuery, TaxCalendarProfile } from './filing-calendar.types.ts'
import { rollForwardDeadline } from './filing-deadline.ts'
import { decideVatPreliminaryKind } from './vat-preliminary-notice.ts'

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
 * 다음 경우에는 의무가 생기지 않지만 프로필이 직전 세액·기업 규모·설립 연도를 모르므로 모두 만들고 대리인이 해당 없는
 * 건을 취소합니다.
 *
 * - 법인 중간예납: 신설법인의 최초 사업연도, 사업연도 6개월 이하, 직전 사업연도 중소기업으로서 계산액 50만원 미만
 *   (법인세법 제63조 ①. 50만원 기준은 중소기업에만 적용합니다)
 * - 개인 중간예납: 그 해 신규 사업자, 중간예납세액 50만원 미만(소득세법 제65조 ①·제86조)
 * - 부가세 예정고지·예정부과: 징수할 금액 50만원 미만 등(부가가치세법 제48조 ③ 단서·제66조 ①)
 *
 * 중간예납기준액이 없는 개인 복식부기의무자가 11월에 중간예납추계액을 신고해야 하는 경우(소득세법 제65조 ⑤)는
 * 고지 건으로 두고 대리인이 바꿉니다. 연말정산은 2월분 원천세(3월 10일)에 들어가므로 따로 만들지 않습니다
 * (소득세법 제137조 ①). 신고 건은 한 번 만들면 기간을 다시 계산하지 않고, 다시 돌리면 기한만 새로 맞춥니다.
 *
 * @example 12월 결산 법인의 11월 일정
 * ```ts
 * resolveFilingObligations({ profile, from: '2026-11-01', to: '2026-11-30', holidays: new Set() })
 * // [{ taxType: 'WITHHOLDING_TAX', periodKey: '2026-10', dueDate: '2026-11-10', ... }]
 * ```
 */
export function resolveFilingObligations(query: FilingObligationQuery): FilingObligation[] {
  const 계산시작연도 = Number(query.from.slice(0, 4)) - 2
  const 계산종료연도 = Number(query.to.slice(0, 4)) + 1
  const 의무목록: ObligationDraft[] = []
  for (let 연도 = 계산시작연도; 연도 <= 계산종료연도; 연도++) {
    의무목록.push(
      ...부가세의무(query.profile, 연도),
      ...원천세의무(query.profile, 연도),
      ...법인세종합소득세확정의무(query.profile, 연도),
      ...중간예납의무(query.profile, 연도),
    )
  }
  return 의무목록
    .map((draft) => 기한이월적용(draft, query.holidays))
    .filter((obligation) => obligation.paymentDue >= query.from && obligation.paymentDue <= query.to)
    .sort((a, b) => a.paymentDue.localeCompare(b.paymentDue) || a.taxType.localeCompare(b.taxType))
}

/** 법정 기한을 이월해 신고·납부 기한을 정합니다. 고지 건은 신고 기한이 없습니다. */
function 기한이월적용(draft: ObligationDraft, 공휴일: ReadonlySet<string>): FilingObligation {
  const 이월기한 = rollForwardDeadline(draft.statutoryDue, 공휴일)
  const 고지건임 = draft.kind === 'NOTICE'
  return {
    ...draft,
    statutoryDue: 고지건임 ? null : draft.statutoryDue,
    dueDate: 고지건임 ? null : 이월기한,
    paymentDue: 이월기한,
  }
}

/**
 * 일반과세자 부가세입니다. 예정신고기간마다 예정고지인지 예정신고인지 {@link decideVatPreliminaryKind}로 정합니다.
 * 직전 과세기간 공급가액은 세무 설정의 과세기간별 값(`vatSupplyAmounts`)에서, 예정신고 선택은 그 과세기간의
 * `vatPreliminaryElections`에서 읽습니다. 예정신고했으면 확정 신고는 남은 3개월, 아니면 과세기간 전체입니다(제49조 ①).
 */
function 부가세의무(profile: TaxCalendarProfile, 연도: number): ObligationDraft[] {
  if (profile.businessType === 'INDIVIDUAL' && profile.vatTaxpayerType === 'SIMPLIFIED')
    return 간이과세자부가세의무(연도, profile.vatSimplifiedInvoiceIssuer === true)
  return ([1, 2] as const).flatMap((반기): ObligationDraft[] => {
    const 과세기간 = `${연도}-H${반기}`
    const 직전과세기간 = 반기 === 1 ? `${연도 - 1}-H2` : `${연도}-H1`
    const 예정신고대상임 =
      decideVatPreliminaryKind({
        businessType: profile.businessType,
        priorPeriodSupplyAmount: profile.vatSupplyAmounts[직전과세기간] ?? null,
        election: profile.vatPreliminaryElections[과세기간] ?? null,
      }) === 'PRELIMINARY'
    const 과세기간시작월 = monthOf(연도, 반기 === 1 ? 1 : 7)
    const 예정신고기간종료월 = addMonths(과세기간시작월, 2)
    const 확정신고기간시작월 = 예정신고대상임 ? addMonths(과세기간시작월, 3) : 과세기간시작월
    const 과세기간종료월 = addMonths(과세기간시작월, 5)
    return [
      {
        taxType: 'VAT',
        kind: 예정신고대상임 ? 'PRELIMINARY' : 'NOTICE',
        periodKey: 과세기간,
        periodStart: `${과세기간시작월}-01`,
        periodEnd: lastDayOfMonth(예정신고기간종료월),
        statutoryDue: `${addMonths(예정신고기간종료월, 1)}-25`,
      },
      {
        taxType: 'VAT',
        kind: 'FINAL',
        periodKey: 과세기간,
        periodStart: `${확정신고기간시작월}-01`,
        periodEnd: lastDayOfMonth(과세기간종료월),
        statutoryDue: `${addMonths(과세기간종료월, 1)}-25`,
      },
    ]
  })
}

/**
 * 간이과세자의 부가세입니다. 1–6월은 예정부과(7월 25일, 고지)이고, 1년 확정 신고는 다음 해 1월 25일입니다
 * (부가가치세법 제66조 ①, 제67조 ①). 예정부과기간에 세금계산서를 발급했으면 고지 대신 7월 25일까지 예정 신고합니다
 * (제66조 ③).
 *
 * 과세 유형이 바뀐 해(제5조 ④)는 다루지 않습니다. 그 해에는 과세기간이 반기로 줄고, 간이에서 일반으로 바뀌면
 * 예정부과도 없습니다(제66조 ① 2호). 프로필에 유형 변경 이력이 없어 대리인이 그 해 신고 건을 고칩니다.
 */
function 간이과세자부가세의무(연도: number, 세금계산서발급자임: boolean): ObligationDraft[] {
  return [
    {
      taxType: 'VAT',
      kind: 세금계산서발급자임 ? 'PRELIMINARY' : 'NOTICE',
      periodKey: `${연도}-H1`,
      periodStart: `${연도}-01-01`,
      periodEnd: `${연도}-06-30`,
      statutoryDue: `${연도}-07-25`,
    },
    {
      taxType: 'VAT',
      kind: 'FINAL',
      periodKey: String(연도),
      periodStart: `${연도}-01-01`,
      periodEnd: `${연도}-12-31`,
      statutoryDue: `${연도 + 1}-01-25`,
    },
  ]
}

function 원천세의무(profile: TaxCalendarProfile, 연도: number): ObligationDraft[] {
  if (profile.withholdingCycle === 'SEMIANNUAL') {
    return ([1, 2] as const).map((반기) => {
      const 반기시작월 = monthOf(연도, 반기 === 1 ? 1 : 7)
      const 반기종료월 = addMonths(반기시작월, 5)
      return {
        taxType: 'WITHHOLDING_TAX',
        kind: 'SEMIANNUAL',
        periodKey: `${연도}-H${반기}`,
        periodStart: `${반기시작월}-01`,
        periodEnd: lastDayOfMonth(반기종료월),
        statutoryDue: `${addMonths(반기종료월, 1)}-10`,
      }
    })
  }
  return Array.from({ length: 12 }, (_, index) => {
    const 귀속월 = monthOf(연도, index + 1)
    return {
      taxType: 'WITHHOLDING_TAX',
      kind: 'MONTHLY',
      periodKey: 귀속월,
      periodStart: `${귀속월}-01`,
      periodEnd: lastDayOfMonth(귀속월),
      statutoryDue: `${addMonths(귀속월, 1)}-10`,
    }
  })
}

function 법인세종합소득세확정의무(profile: TaxCalendarProfile, 연도: number): ObligationDraft[] {
  if (profile.businessType === 'INDIVIDUAL') {
    return [
      {
        taxType: 'INCOME_TAX',
        kind: 'ANNUAL',
        periodKey: String(연도),
        periodStart: `${연도}-01-01`,
        periodEnd: `${연도}-12-31`,
        statutoryDue: profile.sincereFilingTarget ? `${연도 + 1}-06-30` : `${연도 + 1}-05-31`,
      },
    ]
  }
  const 사업연도종료월 = monthOf(연도, profile.fiscalYearEndMonth)
  return [
    {
      taxType: 'CORPORATE_TAX',
      kind: 'ANNUAL',
      periodKey: String(연도),
      periodStart: `${addMonths(사업연도종료월, -11)}-01`,
      periodEnd: lastDayOfMonth(사업연도종료월),
      statutoryDue: lastDayOfMonth(addMonths(사업연도종료월, profile.sincereFilingTarget ? 4 : 3)),
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
function 중간예납의무(profile: TaxCalendarProfile, 연도: number): ObligationDraft[] {
  if (profile.businessType === 'INDIVIDUAL') {
    return [
      {
        taxType: 'INCOME_TAX',
        kind: 'NOTICE',
        periodKey: `${연도}-H1`,
        periodStart: `${연도}-01-01`,
        periodEnd: `${연도}-06-30`,
        statutoryDue: `${연도}-11-30`,
      },
    ]
  }
  const 사업연도시작월 = addMonths(monthOf(연도, profile.fiscalYearEndMonth), -11)
  const 중간예납기간종료월 = addMonths(사업연도시작월, 5)
  return [
    {
      taxType: 'CORPORATE_TAX',
      kind: 'INTERIM',
      periodKey: String(연도),
      periodStart: `${사업연도시작월}-01`,
      periodEnd: lastDayOfMonth(중간예납기간종료월),
      statutoryDue: lastDayOfMonth(addMonths(중간예납기간종료월, 2)),
    },
  ]
}

function monthOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}
