import type { INTERIM_SETTLEMENT_REASONS } from './leaving-reasons.ts'

/** 퇴직(상실) 사유와 상세 사유입니다. */
export interface LeavingReason {
  code: string
  name: string
  details: ReadonlyArray<{ code: string; name: string }>
}

/** 퇴직금·퇴직연금 유형입니다. */
export type RetirementBenefitType = 'SEVERANCE_PAY' | 'DB' | 'DC'

/**
 * Payroll 퇴직금 정산 한 건의 상태입니다. 계산됨, 지급 완료, 정산 대상에서 제외입니다. HR은 저장하지 않고
 * `SeveranceSettlementLookup`으로 묻습니다. 값은 Payroll 정산 상태와 같습니다(docs/design/payroll.md 열린 질문 16).
 */
export type SeveranceSettlementStatus = 'CALCULATED' | 'COMPLETED' | 'EXCLUDED'

/** 퇴직금 중간정산 사유입니다. */
export type InterimSettlementReason = (typeof INTERIM_SETTLEMENT_REASONS)[number]

/** 퇴직금 설정입니다. 퇴직 여부와 상관없이 저장합니다. */
export interface RetirementPlan {
  benefitType: RetirementBenefitType
  interimSettlement?: { date: string; reasonCode: InterimSettlementReason } | undefined
}

/** `:resign`으로 기록하는 퇴직입니다. */
export interface Resignation {
  leaveDate: string
  leavingReasonCode: string
  leavingDetailReasonCode?: string | undefined
  severanceAmount?: number | undefined
}

/** 퇴직 검증이 거절하는 이유입니다. */
export type ResignationRejection = 'LEAVE_DATE_BEFORE_JOIN' | 'LEAVE_DATE_BEFORE_INTERIM' | 'LEAVING_REASON_INVALID'
