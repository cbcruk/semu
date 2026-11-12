import type { Id } from '../../../shared/ids/ids.types.ts'

/** 4대보험 신고 종류입니다. 취득·상실·휴직·복직·피부양자·보수 변경입니다. */
export type InsuranceFilingKind = 'ACQUISITION' | 'LOSS' | 'LEAVE' | 'RETURN' | 'DEPENDANT' | 'REMUNERATION_CHANGE'

/**
 * 신고 처리 상태입니다. 대리인이 `PENDING`을 `DONE`(완료)이나 `FAILED`(반려·오류)로 옮기고, 실패한 신고는 다시
 * 처리해 `DONE`으로 닫을 수 있습니다. 원인이 취소되면 열린 신고(`PENDING`·`FAILED`)는 `WITHDRAWN`입니다.
 */
export type InsuranceFilingStatus = 'PENDING' | 'DONE' | 'FAILED' | 'WITHDRAWN'

/** 신고를 만든 원인입니다. 원인이 취소될 때 같은 원인의 열린 신고를 닫습니다. */
export interface InsuranceFilingSource {
  type: 'EMPLOYEE' | 'LEAVE' | 'FAMILY_MEMBER' | 'PAYROLL_CONTRACT'
  id: string
}

/** 종류별 신고 내용입니다. 대리인이 공단 신고서에 옮기는 값입니다. */
export interface InsuranceFilingPayloads {
  /** 자격 취득일은 입사일입니다. */
  ACQUISITION: { acquisitionDate: string }
  /** 자격 상실일은 퇴직일(마지막 근무일) 다음 날입니다. 사유 코드는 고용보험 상실 사유입니다. */
  LOSS: { leaveDate: string; lossDate: string; leavingReasonCode: string; leavingDetailReasonCode?: string }
  /** 국민연금 납부예외·건강보험 고지유예 신청 여부가 들어갑니다. */
  LEAVE: { startDate: string; endDate: string; npsPaymentException: boolean; nhisNoticeDeferral: boolean }
  RETURN: { leaveStartDate: string; returnDate: string }
  DEPENDANT: { familyMemberId: string }
  /** 새 급여계약의 시작일과 금액입니다. 보수월액은 대리인이 이 값으로 정합니다. */
  REMUNERATION_CHANGE: { effectiveFrom: string; wageType: 'MONTHLY' | 'DAILY' | 'HOURLY'; amount: number }
}

/** 4대보험 신고 한 건입니다. 세무 대리인이 처리합니다. */
export type InsuranceFiling = {
  [K in InsuranceFilingKind]: {
    id: Id<'insuranceFiling'>
    companyId: Id<'company'>
    employeeId: Id<'employee'>
    kind: K
    source: InsuranceFilingSource
    payload: InsuranceFilingPayloads[K]
    status: InsuranceFilingStatus
    requestedAt: string
    processedAt?: string
    /** 실패 처리할 때 대리인이 남긴 사유입니다. 완료하면 지웁니다. */
    resultMessage?: string
  }
}[InsuranceFilingKind]

/** 대리인의 처리 커맨드입니다. */
export type InsuranceFilingCommand = { type: 'COMPLETE' } | { type: 'FAIL'; message: string }
