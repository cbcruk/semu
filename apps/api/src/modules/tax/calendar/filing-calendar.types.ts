import type { BusinessType } from '../../identity-access/actor.types.ts'
import type { FilingKind, TaxType } from '../tax.types.ts'

/** 원천세 납부 주기입니다. 반기별 납부 승인을 받은 사업장만 `SEMIANNUAL`입니다. */
export type WithholdingCycle = 'MONTHLY' | 'SEMIANNUAL'

/**
 * 예정고지 대상이 예정신고를 고른 사유입니다(부가가치세법 제48조 ④, 시행령 제90조 ⑥).
 *
 * - `BUSINESS_DECLINE`: 휴업·사업 부진 등으로 예정신고기간의 공급가액 또는 납부세액이 직전 과세기간의 1/3에 미달(1호)
 * - `EARLY_REFUND`: 그 예정신고기간분을 조기환급 받으려 함(2호)
 */
export type VatPreliminaryElectionReason = 'BUSINESS_DECLINE' | 'EARLY_REFUND'

/**
 * 부가세 과세 유형입니다. 간이과세자(`SIMPLIFIED`)는 개인사업자만 될 수 있고(부가가치세법 제61조),
 * 과세기간이 1월 1일–12월 31일입니다(제5조 ①).
 */
export type VatTaxpayerType = 'GENERAL' | 'SIMPLIFIED'

/** 신고 일정을 정하는 회사의 세무 설정입니다. */
export interface TaxCalendarProfile {
  businessType: BusinessType
  /** 사업연도 종료 월(1–12)입니다. 법인세 기간과 기한을 정합니다. */
  fiscalYearEndMonth: number
  withholdingCycle: WithholdingCycle
  /**
   * 일반과세자 과세기간(`2026-H2`)별 공급가액 합계액(원)입니다. 확정 신고를 마치면 대리인이 넣고, 다음 과세기간의
   * 예정고지 판정에 씁니다(부가가치세법 시행령 제90조 ④). 없는 기간은 모르는 것으로 봅니다.
   */
  vatSupplyAmounts: Readonly<Record<string, number>>
  /** 예정고지 대신 예정신고를 고른 과세기간(`2027-H1`)과 사유입니다. 없는 기간은 고르지 않은 것입니다. */
  vatPreliminaryElections: Readonly<Record<string, VatPreliminaryElectionReason>>
  /** 부가세 과세 유형입니다. 법인은 `SIMPLIFIED`여도 일반과세자로 계산합니다. */
  vatTaxpayerType: VatTaxpayerType
  /**
   * 간이과세자가 예정부과기간(1–6월)에 세금계산서를 발급했는지입니다. 참이면 예정부과 고지 대신 예정 신고
   * (`PRELIMINARY`)입니다(부가가치세법 제66조 ③). 없으면 거짓으로 봅니다.
   */
  vatSimplifiedInvoiceIssuer?: boolean | undefined
  /** 성실신고확인 대상이면 법인세·종합소득세 기한이 한 달 늦습니다. */
  sincereFilingTarget: boolean
}

/** {@link resolveFilingObligations}의 입력입니다. */
export interface FilingObligationQuery {
  profile: TaxCalendarProfile
  /** 납부 기한 하한(포함)입니다. */
  from: string
  /** 납부 기한 상한(포함)입니다. */
  to: string
  /** 주말 말고 기한을 미루는 날입니다. 공휴일·대체공휴일·근로자의 날을 넣습니다. */
  holidays: ReadonlySet<string>
}

/** 신고 의무 하나와 그 기간·기한입니다. */
export interface FilingObligation {
  taxType: TaxType
  kind: FilingKind
  /**
   * 세목·종류 안에서 유일한 기간 이름입니다. 반기는 `2026-H1`, 월은 `2026-10`, 연은 `2026`입니다.
   * 법인세의 연은 사업연도가 끝나는 해입니다.
   */
  periodKey: string
  periodStart: string
  periodEnd: string
  /** 미루기 전 법정 기한입니다. 신고서가 없는 예정고지는 `null`입니다. */
  statutoryDue: string | null
  /** 주말·공휴일을 미룬 신고 기한입니다. 예정고지는 `null`입니다. */
  dueDate: string | null
  /** 주말·공휴일을 미룬 납부 기한입니다. 신고 기한과 같습니다. */
  paymentDue: string
}
