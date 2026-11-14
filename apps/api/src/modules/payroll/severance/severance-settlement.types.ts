import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SeveranceResult } from '../engine/engine.types.ts'

/** 퇴직금 정산 상태입니다. 계산됨, 지급 완료, 정산 대상에서 제외입니다. */
export type SeveranceStatus = 'CALCULATED' | 'COMPLETED' | 'EXCLUDED'

/** 정산 종류입니다. 퇴직(`RETIREMENT`)과 재직 중 중간정산(`INTERIM`)입니다. */
export type SeveranceKind = 'RETIREMENT' | 'INTERIM'

/**
 * 퇴직금 중간정산 사유입니다(근로자퇴직급여 보장법 시행령 제3조제1항). 값은 HR `INTERIM_SETTLEMENT_REASONS`와 같습니다.
 *
 * 무주택자 주택 구입, 무주택자 전세금·보증금(한 사업에서 1회), 6개월 이상 요양 의료비, 5년 안의 파산선고·개인회생,
 * 임금피크제, 근로시간 단축(1일 1시간 또는 1주 5시간 이상 줄여 3개월 이상), 법정 근로시간 단축으로 줄어든 임금, 재난 피해입니다.
 */
export type InterimSettlementReason =
  | 'HOME_PURCHASE'
  | 'RENT_DEPOSIT'
  | 'MEDICAL_TREATMENT'
  | 'BANKRUPTCY'
  | 'PERSONAL_REHABILITATION'
  | 'WAGE_PEAK'
  | 'WORK_HOURS_REDUCTION'
  | 'LEGAL_WORK_HOURS_REDUCTION'
  | 'GOVERNMENT_NOTICE'

/** 저장된 퇴직금 계산 입력입니다. */
export interface SeveranceInputRecord {
  threeMonthWages: number
  threeMonthDays?: number
  annualBonus?: number
  annualLeavePay?: number
  ordinaryDailyWage?: number
}

/** 퇴직금 정산 한 건입니다. 직원 한 명의 한 번의 퇴직이나 한 번의 중간정산입니다. */
export interface SeveranceSettlementRecord {
  id: Id<'severanceSettlement'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  employeeName: string
  /** 정산 종류입니다. 중간정산이 생기기 전에 저장한 정산에는 없고 퇴직(`RETIREMENT`)입니다. */
  kind?: SeveranceKind
  /** 중간정산 사유입니다. 중간정산에만 있습니다. */
  interimReason?: InterimSettlementReason
  joinDate: string
  /** 계속근로기간의 기산일입니다. 마지막 완료 중간정산의 다음 날이고 없으면 입사일입니다. 이 필드 전에 저장한 정산에는 없고 입사일입니다. */
  serviceStartDate?: string
  /** 마지막 근무일입니다. 중간정산이면 정산 기준일(그날까지의 퇴직금을 정산)입니다. */
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
