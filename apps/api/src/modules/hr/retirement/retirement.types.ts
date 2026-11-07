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
 * 퇴직금 정산 상태입니다. Payroll이 알려 줄 값이지만 그 이벤트·구독은 아직 없어 지금은 채워지지 않습니다.
 * Payroll 정산 상태(`CALCULATED`·`COMPLETED`·`EXCLUDED`)와의 매핑도 정하지 않았습니다(docs/design/payroll.md 열린 질문 16).
 */
export type SeveranceSettlementStatus = 'IN_PROGRESS' | 'COMPLETED' | 'EXCLUDED'

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
