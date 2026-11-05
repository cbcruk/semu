/** 근로계약 형태입니다. `FIXED_TERM`은 기간제(현행 `contract`)입니다. */
export type ContractType = 'PERMANENT' | 'FIXED_TERM'

/** 날짜로 계산하는 근로계약 상태입니다. */
export type WorkContractStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED'

/**
 * 기간제 사용기간 2년 제한의 예외 사유입니다(기간제법 제4조 ① 단서). 고령자(제4호, 만 55세 이상)는 생년월일로 계산하므로 없습니다.
 *
 * - `PROJECT_COMPLETION`: 사업 완료·특정 업무 완성에 필요한 기간(제1호)
 * - `REPLACEMENT`: 휴직·파견 등 결원 대체(제2호)
 * - `STUDY_OR_TRAINING`: 학업·직업훈련 이수 기간(제3호)
 * - `PROFESSIONAL`: 박사 학위, 기술사, 시행령 별표 2 전문자격 소지자의 해당 분야 종사(제5호, 시행령 제3조 ①)
 * - `GOVERNMENT_JOB_PROGRAM`: 정부 복지정책·실업대책 등의 일자리(제5호, 시행령 제3조 ②)
 * - `OTHER_STATUTORY`: 시행령 제3조 ③의 사유(다른 법령, 대학 강사·조교, 고소득 전문직, 초단시간 등)(제6호)
 */
export type TermLimitExemption =
  | 'PROJECT_COMPLETION'
  | 'REPLACEMENT'
  | 'STUDY_OR_TRAINING'
  | 'PROFESSIONAL'
  | 'GOVERNMENT_JOB_PROGRAM'
  | 'OTHER_STATUTORY'

/** 상태·경고 계산에 쓰는 계약 기간입니다. */
export interface ContractPeriod {
  contractType: ContractType
  startDate: string
  endDate?: string | undefined
  /** 기간제 사용기간 제한의 예외 사유입니다. 증빙은 회사가 보관합니다. */
  termLimitExemption?: TermLimitExemption | undefined
}
