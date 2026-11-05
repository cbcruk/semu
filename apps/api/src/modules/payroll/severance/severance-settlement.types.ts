import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SeveranceResult } from '../engine/engine.types.ts'

/** 퇴직금 정산 상태입니다. 계산됨, 지급 완료, 정산 대상에서 제외입니다. */
export type SeveranceStatus = 'CALCULATED' | 'COMPLETED' | 'EXCLUDED'

/** 저장된 퇴직금 계산 입력입니다. */
export interface SeveranceInputRecord {
  threeMonthWages: number
  threeMonthDays?: number
  annualBonus?: number
  annualLeavePay?: number
  ordinaryDailyWage?: number
}

/** 퇴직금 정산 한 건입니다. 직원 한 명의 한 번의 퇴직입니다. */
export interface SeveranceSettlementRecord {
  id: Id<'severanceSettlement'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  employeeName: string
  joinDate: string
  lastWorkDate: string
  status: SeveranceStatus
  input: SeveranceInputRecord
  result: SeveranceResult
  rateTable: string
  version: number
  createdAt: string
  updatedAt: string
}
