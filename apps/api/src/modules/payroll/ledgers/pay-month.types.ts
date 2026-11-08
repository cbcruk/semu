/** 원천세 집계의 소득 종류입니다. Tax가 원천징수이행상황신고서의 줄 코드(A01·A03·A25 등)로 바꿉니다. */
export type WithholdingIncomeKind = 'WAGE' | 'DAILY' | 'BUSINESS' | 'OTHER'

/** 지급월 원천세 집계의 한 줄입니다. */
export interface WithholdingSummaryLine {
  incomeKind: WithholdingIncomeKind
  headcount: number
  grossPay: number
  taxablePay: number
  incomeTax: number
  localIncomeTax: number
}
