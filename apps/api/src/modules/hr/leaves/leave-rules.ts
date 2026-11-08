import type { Violation } from '../../../shared/problem/problem.types.ts'
import { addDays, addMonths, daysBetween } from '../../../shared/time/calendar.ts'
import { isOnLeave, lastLeaveDay } from '../employees/employee-status.ts'
import { minDate } from '../shared/hr-dates.ts'
import type { ExistingLeave, LeaveContext, LeaveSummary, LeaveTerms, LeaveValidation } from './leave-rules.types.ts'

/** 육아휴직 한도(일)입니다. 남녀고용평등법 제19조의 자녀 1명당 1년입니다. */
export const PARENTAL_LEAVE_DAYS = 365

/**
 * 건강보험 납입고지가 유예되는 첫 달과 마지막 달(`YYYY-MM`)입니다. 유예되는 달이 없으면 `undefined`입니다.
 *
 * 국민건강보험법 시행규칙 제50조 ④: 사유가 생긴 날이 속한 달의 다음 달(1일이면 그 달)부터 사유가 없어진 날이 속한
 * 달(1일이면 그 전달)까지입니다. 사유가 없어진 날은 종료일 다음날(복직일)로 봅니다.
 *
 * @example
 * ```ts
 * nhisDeferredMonths('2026-03-01', '2026-03-30') // { first: '2026-03', last: '2026-03' }
 * nhisDeferredMonths('2026-03-15', '2026-03-31') // undefined
 * ```
 */
export function nhisDeferredMonths(startDate: string, endDate: string): { first: string; last: string } | undefined {
  const 복직일 = addDays(endDate, 1)
  const 유예시작월 = startDate.endsWith('-01') ? startDate.slice(0, 7) : addMonths(startDate.slice(0, 7), 1)
  const 유예종료월 = 복직일.endsWith('-01') ? addMonths(복직일.slice(0, 7), -1) : 복직일.slice(0, 7)
  return 유예시작월 <= 유예종료월 ? { first: 유예시작월, last: 유예종료월 } : undefined
}

/**
 * 휴직 입력을 검사합니다(현행 R15·R16).
 *
 * - 종료일은 시작일 이후, 시작일은 입사일 이후, 종료일은 퇴직일 이전
 * - 유급휴직이면 수당 필수
 * - 복직일은 시작일 다음날부터 종료일 다음날까지
 * - 건강보험 납입고지유예는 유예되는 달이 한 달 이상이어야 합니다({@link nhisDeferredMonths})
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
  const 복직일 = terms.actualReturnDate
  if (복직일 !== undefined && (복직일 <= terms.startDate || 복직일 > addDays(terms.endDate, 1))) {
    violations.push({ field: 'actualReturnDate', code: 'RETURN_DATE_OUT_OF_RANGE' })
  }
  if (terms.nhisNoticeDeferral === true && nhisDeferredMonths(terms.startDate, terms.endDate) === undefined) {
    violations.push({ field: 'nhisNoticeDeferral', code: 'DEFERRAL_NEEDS_ONE_MONTH' })
  }
  const 겹치는휴직 = context.otherLeaves.find(
    (other) => other.startDate <= terms.endDate && lastLeaveDay(other) >= terms.startDate,
  )
  return {
    violations,
    ...(겹치는휴직 === undefined ? {} : { overlappingLeaveId: 겹치는휴직.id }),
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
  const 현재휴직 = leaves.find((leave) => isOnLeave(leave, asOf))
  const 예정휴직 = leaves
    .filter((leave) => leave.startDate > asOf)
    .reduce<ExistingLeave | undefined>(
      (가장이른휴직, leave) =>
        가장이른휴직 === undefined || leave.startDate < 가장이른휴직.startDate ? leave : 가장이른휴직,
      undefined,
    )
  const 지난휴직일수 = (leave: ExistingLeave): number =>
    leave.startDate > asOf ? 0 : daysBetween(leave.startDate, minDate(lastLeaveDay(leave), asOf)) + 1
  const 육아휴직일수 = leaves
    .filter((leave) => leave.reason === 'PARENTAL')
    .reduce((total, leave) => total + daysBetween(leave.startDate, lastLeaveDay(leave)) + 1, 0)
  return {
    isOnLeave: 현재휴직 !== undefined,
    ...(현재휴직 === undefined ? {} : { currentLeaveId: 현재휴직.id }),
    ...(예정휴직 === undefined ? {} : { upcomingLeaveId: 예정휴직.id }),
    totalLeaveDays: leaves.reduce((total, leave) => total + 지난휴직일수(leave), 0),
    parentalLeaveDays: 육아휴직일수,
    parentalLeaveRemainingDays: Math.max(0, PARENTAL_LEAVE_DAYS - 육아휴직일수),
  }
}
