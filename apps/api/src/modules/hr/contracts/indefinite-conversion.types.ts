/** 무기계약 전환 판정 결과입니다. */
export interface IndefiniteConversion {
  /** 경고 대상인지입니다. 예외자는 `false`입니다. */
  isTarget: boolean
  status: 'NONE' | 'APPROACHING' | 'EXCEEDED'
  isExempt: boolean
  exemptReason?: 'AGED_55_OR_OVER'
  chainStartDate?: string
  chainEndDate?: string
  totalContractDays: number
  conversionDate?: string
  daysUntilConversion?: number
}
