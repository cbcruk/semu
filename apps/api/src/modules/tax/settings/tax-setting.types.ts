import type {
  VatPreliminaryElectionReason,
  VatTaxpayerType,
  WithholdingCycle,
} from '../calendar/filing-calendar.types.ts'

/**
 * 저장된 회사 세무 설정입니다. 응답 스키마 `TaxSetting`과 같은 모양입니다.
 *
 * 사업자 형태와 플랜은 회사 사실이라 여기 없고, `TaxProfiles`가 둘을 합쳐 `TaxProfile`을 만듭니다.
 */
export interface TaxSettingRecord {
  /** 사업연도 종료 월(1–12)입니다. 개인사업자는 12입니다. */
  fiscalYearEndMonth: number
  withholdingCycle: WithholdingCycle
  sincereFilingTarget: boolean
  vatTaxpayerType: VatTaxpayerType
  /** 간이과세자가 예정부과기간에 세금계산서를 발급했는지입니다. 간이과세자만 참일 수 있습니다. */
  vatSimplifiedInvoiceIssuer: boolean
  /** 카드 매출 중 과세 매출 비율입니다. ppm(100% = 1,000,000)입니다. */
  taxableCardRatioPpm: number
  /** 과세기간(`2026-H2`)별 공급가액 합계액(원)입니다. */
  vatSupplyAmounts: Readonly<Record<string, number>>
  /** 예정고지 대신 예정신고를 고른 과세기간(`2027-H1`)과 사유입니다. */
  vatPreliminaryElections: Readonly<Record<string, VatPreliminaryElectionReason>>
  version: number
  updatedAt: string | null
}

/** 세무 설정이 규칙에 맞지 않는 이유입니다. 422 `TAX_SETTING_INVALID`의 `reason`입니다. */
export type TaxSettingInvalidReason =
  | 'FISCAL_YEAR_END_MONTH_OUT_OF_RANGE'
  | 'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR'
  | 'CORPORATION_CANNOT_BE_SIMPLIFIED'
  | 'INVOICE_ISSUER_REQUIRES_SIMPLIFIED'
  | 'TAXABLE_CARD_RATIO_OUT_OF_RANGE'
  | 'VAT_PERIOD_KEY_INVALID'
  | 'VAT_SUPPLY_AMOUNT_INVALID'

/** 규칙 위반 하나입니다. `field`는 위반한 필드이고, 과세기간 키 위반이면 `vatSupplyAmounts.2026-H3`처럼 키를 붙입니다. */
export interface TaxSettingViolation {
  reason: TaxSettingInvalidReason
  field: string
}
