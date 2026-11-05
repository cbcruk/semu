import type { Violation } from '../../../shared/problem/problem.types.ts'

/** 휴직 사유입니다. 출산전후휴가·육아휴직·질병·기타입니다. */
export type LeaveReason = 'MATERNITY' | 'PARENTAL' | 'ILLNESS' | 'OTHER'

/** 검증할 휴직 입력입니다. */
export interface LeaveTerms {
  reason: LeaveReason
  startDate: string
  endDate: string
  expectedReturnDate?: string | undefined
  actualReturnDate?: string | undefined
  /** 유급휴직이면 수당(원)입니다. 유급인데 수당이 없으면 위반입니다. */
  paid?: { allowance?: number | undefined } | undefined
  includeInServiceYears?: boolean | undefined
  npsPaymentException?: boolean | undefined
  nhisNoticeDeferral?: boolean | undefined
}

/** 겹침 검사에 쓰는 다른 휴직입니다. */
export interface ExistingLeave {
  id: string
  reason: LeaveReason
  startDate: string
  endDate: string
  actualReturnDate?: string | undefined
}

/** 휴직 검증 맥락입니다. */
export interface LeaveContext {
  joinDate?: string | undefined
  /** 퇴직일입니다. 휴직은 퇴직일을 넘을 수 없습니다. */
  leaveDate?: string | undefined
  otherLeaves: ReadonlyArray<ExistingLeave>
}

/** 휴직 검증 결과입니다. 겹침은 다른 오류 코드(`LEAVE_OVERLAP`)라 따로 돌려줍니다. */
export interface LeaveValidation {
  violations: Violation[]
  overlappingLeaveId?: string
  /** 저장할 값입니다. 복직 예정일 기본값과 육아휴직 근속 포함을 채웠습니다. */
  normalized: {
    expectedReturnDate: string
    includeInServiceYears: boolean
  }
}

/** 휴직 이력 요약입니다. */
export interface LeaveSummary {
  isOnLeave: boolean
  currentLeaveId?: string
  upcomingLeaveId?: string
  /** `asOf`까지 지난 휴직 일수 합입니다. */
  totalLeaveDays: number
  /** 육아휴직 전체 일수 합입니다(미래 포함). */
  parentalLeaveDays: number
  parentalLeaveRemainingDays: number
}
