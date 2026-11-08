/**
 * 원천세 합계의 소득 종류입니다. Payroll이 지급월마다 이 종류로 모아 줍니다.
 *
 * `RETIREMENT`(퇴직소득)는 신고서 줄 코드만 정해 두었고, Payroll이 아직 집계하지 않습니다(#49).
 */
export type WithholdingIncomeKind = 'WAGE' | 'DAILY' | 'BUSINESS' | 'OTHER' | 'RETIREMENT'

/**
 * 기타소득의 구분입니다. `PERSONAL_SERVICE`는 소득세법 제21조제1항제19호의 인적용역, `GENERAL`은 그 밖의 기타소득입니다.
 * 어떤 지급사유가 인적용역인지는 Payroll이 정하고, 그 구분을 어느 줄에 적을지는 Tax가 정합니다.
 */
export type OtherIncomeCategory = 'PERSONAL_SERVICE' | 'GENERAL'

/**
 * 원천징수이행상황신고서 제1쪽에서 한 소득 종류의 합계를 적는 줄의 소득구분 코드입니다.
 * `A01` 근로 간이세액, `A03` 근로 일용근로, `A22` 퇴직 그 외, `A25` 사업 매월징수, `A59` 기타 인적용역, `A42` 기타 그 외.
 */
export type WithholdingLineCode = 'A01' | 'A03' | 'A22' | 'A25' | 'A59' | 'A42'

/** 그 줄이 속한 소득의 가감계 코드입니다. `A10` 근로, `A20` 퇴직, `A30` 사업, `A40` 기타. */
export type WithholdingSubtotalCode = 'A10' | 'A20' | 'A30' | 'A40'

/** 지급월에 지급한 한 소득 종류의 원천세 합계입니다. Payroll이 포트로 알려 줍니다. */
export interface WithholdingTotal {
  incomeKind: WithholdingIncomeKind
  /** 기타소득(`OTHER`)의 구분입니다. 다른 소득 종류는 `null`입니다. */
  otherIncomeCategory: OtherIncomeCategory | null
  /** 인원입니다. 소득자를 중복 없이 셉니다. */
  headcount: number
  /** 총지급액입니다. 비과세를 포함합니다. */
  grossPay: number
  taxablePay: number
  incomeTax: number
  localIncomeTax: number
}

/** 신고서 줄 코드를 붙인 원천세 합계입니다. */
export interface WithholdingReturnLine extends WithholdingTotal {
  lineCode: WithholdingLineCode
  subtotalCode: WithholdingSubtotalCode
}

/** 신고 기간 안의 지급월 하나의 신고서 줄과, 그 달 급여대장의 마감 현황입니다. */
export interface WithholdingReturnMonth {
  paymentMonth: string
  /** 지급일이 그 달인 급여대장 수입니다. */
  ledgerCount: number
  /** 그중 마감된 수입니다. `lines`는 마감된 대장만 더하므로, 둘이 다르면 아직 바뀔 수 있는 합계입니다. */
  closedCount: number
  lines: ReadonlyArray<WithholdingReturnLine>
}
