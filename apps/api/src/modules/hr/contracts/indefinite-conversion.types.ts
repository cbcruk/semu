import type { TermLimitExemption } from './work-contract-period.types.ts'

/** 무기계약 전환 판정 결과입니다. */
export interface IndefiniteConversion {
  /** 경고 대상인지입니다. 예외자는 `false`입니다. */
  isTarget: boolean
  status: 'NONE' | 'APPROACHING' | 'EXCEEDED'
  isExempt: boolean
  /** 예외 사유입니다. 만 55세 이상(`AGED_55_OR_OVER`)이 계약의 예외 사유보다 먼저입니다. */
  exemptReason?: 'AGED_55_OR_OVER' | TermLimitExemption
  chainStartDate?: string
  chainEndDate?: string
  totalContractDays: number
  conversionDate?: string
  daysUntilConversion?: number
}
