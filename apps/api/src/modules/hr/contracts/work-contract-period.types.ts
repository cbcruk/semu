/** 근로계약 형태입니다. `FIXED_TERM`은 기간제(현행 `contract`)입니다. */
export type ContractType = 'PERMANENT' | 'FIXED_TERM'

/** 날짜로 계산하는 근로계약 상태입니다. */
export type WorkContractStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'

/** 상태·경고 계산에 쓰는 계약 기간입니다. */
export interface ContractPeriod {
  contractType: ContractType
  startDate: string
  endDate?: string | undefined
}
