/** 원천세 집계의 소득 종류입니다. Tax가 원천징수이행상황신고서의 줄 코드(A01·A03·A25 등)로 바꿉니다. */
export type WithholdingIncomeKind = 'WAGE' | 'DAILY' | 'BUSINESS' | 'OTHER'

/**
 * 기타소득의 구분입니다. `PERSONAL_SERVICE`는 소득세법 제21조제1항제19호의 인적용역(지급사유 `76` 강연료등, `79` 자문료등),
 * `GENERAL`은 그 밖의 기타소득입니다. 원천징수이행상황신고서에서 줄이 다릅니다.
 */
export type OtherIncomeCategory = 'PERSONAL_SERVICE' | 'GENERAL'

/** 지급월 원천세 집계의 한 줄입니다. */
export interface WithholdingSummaryLine {
  incomeKind: WithholdingIncomeKind
  /** 기타소득(`OTHER`)의 구분입니다. 다른 소득 종류는 `null`입니다. */
  otherIncomeCategory: OtherIncomeCategory | null
  headcount: number
  grossPay: number
  taxablePay: number
  incomeTax: number
  localIncomeTax: number
}
