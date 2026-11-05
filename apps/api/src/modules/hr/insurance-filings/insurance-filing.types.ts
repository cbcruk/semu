import type { Id } from '../../../shared/ids/ids.types.ts'

/** 4대보험 신고 종류입니다. 취득·상실·휴직·복직·피부양자입니다. */
export type InsuranceFilingKind = 'ACQUISITION' | 'LOSS' | 'LEAVE' | 'RETURN' | 'DEPENDANT'

/** 신고 처리 상태입니다. 원인이 취소되면 `WITHDRAWN`입니다. */
export type InsuranceFilingStatus = 'PENDING' | 'DONE' | 'FAILED' | 'WITHDRAWN'

/** 신고를 만든 원인입니다. 원인이 취소될 때 같은 원인의 열린 신고를 닫습니다. */
export interface InsuranceFilingSource {
  type: 'EMPLOYEE' | 'LEAVE' | 'FAMILY_MEMBER'
  id: string
}

/** 4대보험 신고 한 건입니다. 세무 대리인이 처리합니다. */
export interface InsuranceFiling {
  id: Id<'insuranceFiling'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  kind: InsuranceFilingKind
  source: InsuranceFilingSource
  payload: Readonly<Record<string, unknown>>
  status: InsuranceFilingStatus
  requestedAt: string
  processedAt?: string
}
