/** 날짜로 계산하는 재직 상태입니다. 저장하지 않습니다. */
export type EmployeeStatus = 'PRE_JOINED' | 'JOINED' | 'LEAVE' | 'RESIGNED'

/** 상태 계산에 쓰는 휴직 기간입니다. */
export interface LeavePeriod {
  startDate: string
  endDate: string
  /** 실제 복직일입니다. 있으면 그 전날까지 휴직입니다. */
  actualReturnDate?: string | undefined
}

/** 상태 계산에 쓰는 직원 날짜입니다. */
export interface EmployeeDates {
  /** 입사일입니다. 전자서명으로 막 생긴 직원처럼 모르면 없습니다. */
  joinDate?: string | undefined
  /** 퇴직일입니다. 퇴직일 당일까지 재직입니다. */
  leaveDate?: string | undefined
  leaves: ReadonlyArray<LeavePeriod>
}
