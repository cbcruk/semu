import type { ContractType } from './work-contract-period.types.ts'

/** 수습 조건입니다. 지급률은 ppm(`90% = 900000`)이고 없으면 100%입니다. */
export interface ProbationTerms {
  months?: number | undefined
  payRatePpm?: number | undefined
}

/** 검증할 근로계약 조건입니다. */
export interface WorkContractTerms {
  contractType: ContractType
  startDate: string
  endDate?: string | undefined
  probation?: ProbationTerms | undefined
  /** 한국표준직업분류 코드입니다. 없으면 단순노무 여부를 검사하지 않습니다. */
  standardOccupationCode?: string | undefined
}
