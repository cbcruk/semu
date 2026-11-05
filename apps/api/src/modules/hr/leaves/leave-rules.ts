import type { Violation } from '../../../shared/problem/problem.types.ts'
import { addDays, daysBetween } from '../../../shared/time/calendar.ts'
import { isOnLeave, lastLeaveDay } from '../employees/employee-status.ts'
import { addMonthsToDate, minDate } from '../shared/hr-dates.ts'
import type { ExistingLeave, LeaveContext, LeaveSummary, LeaveTerms, LeaveValidation } from './leave-rules.types.ts'

/** 육아휴직 한도(일)입니다. 남녀고용평등법 제19조의 자녀 1명당 1년입니다. */
export const PARENTAL_LEAVE_DAYS = 365

/**
 * 휴직 입력을 검사합니다(현행 R15·R16).
 *
 * - 종료일은 시작일 이후, 시작일은 입사일 이후, 종료일은 퇴직일 이전
 * - 유급휴직이면 수당 필수
 * - 복직일은 시작일 다음날부터 종료일 다음날까지
 * - 건강보험 납입고지유예는 1개월 이상 휴직만(시작일 + 1개월 ≤ 종료일 다음날)
 * - 다른 휴직과 겹치면 `overlappingLeaveId` (복직한 휴직은 복직일 전날까지로 봄)
 *
 * 육아휴직은 근속에 항상 넣고, 복직 예정일이 없으면 종료일 다음날로 채웁니다.
 */
export function validateLeave(terms: LeaveTerms, context: LeaveContext): LeaveValidation {
  const violations: Violation[] = []
  if (terms.startDate > terms.endDate) violations.push({ field: 'endDate', code: 'END_BEFORE_START' })
  if (context.joinDate !== undefined && terms.startDate < context.joinDate) {
    violations.push({ field: 'startDate', code: 'BEFORE_JOIN_DATE' })
  }
  if (context.leaveDate !== undefined && terms.endDate > context.leaveDate) {
    violations.push({ field: 'endDate', code: 'AFTER_LEAVE_DATE' })
  }
  if (terms.paid !== undefined && terms.paid.allowance === undefined) {
    violations.push({ field: 'paid.allowance', code: 'PAID_ALLOWANCE_REQUIRED' })
  }
  const returned = terms.actualReturnDate
  if (returned !== undefined && (returned <= terms.startDate || returned > addDays(terms.endDate, 1))) {
    violations.push({ field: 'actualReturnDate', code: 'RETURN_DATE_OUT_OF_RANGE' })
  }
  if (terms.nhisNoticeDeferral === true && addMonthsToDate(terms.startDate, 1) > addDays(terms.endDate, 1)) {
    violations.push({ field: 'nhisNoticeDeferral', code: 'DEFERRAL_NEEDS_ONE_MONTH' })
  }
  const overlapping = context.otherLeaves.find(
    (other) => other.startDate <= terms.endDate && lastLeaveDay(other) >= terms.startDate,
  )
  return {
    violations,
    ...(overlapping === undefined ? {} : { overlappingLeaveId: overlapping.id }),
    normalized: {
      expectedReturnDate: terms.expectedReturnDate ?? addDays(terms.endDate, 1),
      includeInServiceYears: terms.reason === 'PARENTAL' || terms.includeInServiceYears === true,
    },
  }
}

/**
 * 휴직 이력을 `asOf` 기준으로 요약합니다.
 *
 * 누적 휴직일은 `asOf`까지 지난 날만 세고, 육아휴직 일수는 미래 휴직까지 셉니다(현행과 같음).
 */
export function summarizeLeaves(leaves: ReadonlyArray<ExistingLeave>, asOf: string): LeaveSummary {
  const current = leaves.find((leave) => isOnLeave(leave, asOf))
  const upcoming = leaves
    .filter((leave) => leave.startDate > asOf)
    .reduce<ExistingLeave | undefined>(
      (first, leave) => (first === undefined || leave.startDate < first.startDate ? leave : first),
      undefined,
    )
  const elapsed = (leave: ExistingLeave): number =>
    leave.startDate > asOf ? 0 : daysBetween(leave.startDate, minDate(lastLeaveDay(leave), asOf)) + 1
  const parental = leaves
    .filter((leave) => leave.reason === 'PARENTAL')
    .reduce((total, leave) => total + daysBetween(leave.startDate, lastLeaveDay(leave)) + 1, 0)
  return {
    isOnLeave: current !== undefined,
    ...(current === undefined ? {} : { currentLeaveId: current.id }),
    ...(upcoming === undefined ? {} : { upcomingLeaveId: upcoming.id }),
    totalLeaveDays: leaves.reduce((total, leave) => total + elapsed(leave), 0),
    parentalLeaveDays: parental,
    parentalLeaveRemainingDays: Math.max(0, PARENTAL_LEAVE_DAYS - parental),
  }
}
