/** 소득세 감면 유형입니다. */
export type IncomeTaxReductionType = 'NONE' | 'SMALL_BUSINESS' | 'RETURNING_KOREAN_TALENT' | 'FOREIGN_TECHNICIAN'

/** 감면 사유 하나입니다. */
export interface IncomeTaxReductionReason {
  type: Exclude<IncomeTaxReductionType, 'NONE'>
  code: string
  name: string
  ratePpm: number
  periodYears: number
  /** 연 감면 한도(원)입니다. 없으면 한도 없음입니다. */
  annualLimit?: number
}

/** 검증할 소득세 공제 설정입니다. */
export interface TaxWithholdingTerms {
  calcMethod: 'TAX_TABLE' | 'MANUAL'
  manualIncomeTax?: number | undefined
  /** 소득세액 조정비율입니다. 80/100/120%만 받습니다(ppm). */
  adjustmentRatePpm: number
  reduction?:
    | {
        type: Exclude<IncomeTaxReductionType, 'NONE'>
        reasonCode?: string | undefined
        application?: 'PAYROLL' | 'YEAR_END' | undefined
        startDate?: string | undefined
        endDate?: string | undefined
        ratePpm?: number | undefined
      }
    | undefined
  studentLoan?:
    { monthlyAmount?: number | undefined; startDate?: string | undefined; endDate?: string | undefined } | undefined
}

/** 검증을 통과한 감면입니다. 사유 코드와 감면율을 채웠습니다. */
export interface ResolvedReduction {
  reasonCode: string
  ratePpm: number
}
