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
  /**
   * 퇴직금 지급일(`YYYY-MM-DD`)입니다. 원천세 퇴직소득 그 외(A22)를 이 날짜의 달(지급월)에 셉니다. 마지막 근무일보다 앞설 수 없습니다.
   * 계산됨 상태에서는 없어도 되고, 완료할 때 없으면 마지막 근무일로 채웁니다(현행 `complete`). 이 필드가 생기기 전에 저장한
   * 정산에는 없습니다.
   */
  paymentDate?: string
  status: SeveranceStatus
  input: SeveranceInputRecord
  result: SeveranceResult
  rateTable: string
  version: number
  createdAt: string
  updatedAt: string
}
