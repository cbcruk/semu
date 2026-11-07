import { addDays } from '../../../shared/time/calendar.ts'
import type { EmployeeDates, EmployeeStatus, LeavePeriod } from './employee-status.types.ts'

/**
 * `asOf` 날짜의 재직 상태입니다.
 *
 * 검사 순서는 퇴직(퇴직일 < asOf), 입사예정(입사일 > asOf), 휴직(asOf가 휴직 기간 안), 재직입니다.
 * 현행 `WORKING`(재직이면서 휴직 아님)은 여기의 `JOINED`와 같습니다.
 *
 * @example 퇴직일 당일은 재직입니다
 * ```ts
 * deriveEmployeeStatus({ joinDate: '2024-01-01', leaveDate: '2026-11-05', leaves: [] }, '2026-11-05') // 'JOINED'
 * ```
 */
export function deriveEmployeeStatus(dates: EmployeeDates, asOf: string): EmployeeStatus {
  if (dates.leaveDate !== undefined && dates.leaveDate < asOf) return 'RESIGNED'
  if (dates.joinDate !== undefined && dates.joinDate > asOf) return 'PRE_JOINED'
  if (dates.leaves.some((leave) => isOnLeave(leave, asOf))) return 'LEAVE'
  return 'JOINED'
}

/** 휴직의 마지막 날입니다. 복직했으면 복직일 전날, 아니면 종료일입니다. */
export function lastLeaveDay(leave: LeavePeriod): string {
  return leave.actualReturnDate === undefined ? leave.endDate : addDays(leave.actualReturnDate, -1)
}

/** `date`가 휴직 기간 안인지입니다. */
export function isOnLeave(leave: LeavePeriod, date: string): boolean {
  return leave.startDate <= date && date <= lastLeaveDay(leave)
}

/** 기간 `from`–`to` 중 하루라도 재직(휴직 포함)했는지입니다. 급여대장 대상자를 고를 때 씁니다. */
export function wasEmployedBetween(dates: Omit<EmployeeDates, 'leaves'>, from: string, to: string): boolean {
  const 종료일에입사예정이아님 = dates.joinDate === undefined || dates.joinDate <= to
  const 시작일전퇴직이아님 = dates.leaveDate === undefined || dates.leaveDate >= from
  return 종료일에입사예정이아님 && 시작일전퇴직이아님
}
