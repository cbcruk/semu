import { LegacyFields } from '../legacy-body.ts'
import type { CreateLeave, Leave, LeaveReason, LeaveSummary } from '../upstream.types.ts'

/** 새 휴직 사유 → 현행 사유입니다. 현행 `etc`는 새 `OTHER`입니다. */
const REASON: Record<LeaveReason, string> = {
  MATERNITY: 'maternity',
  PARENTAL: 'parental',
  ILLNESS: 'illness',
  OTHER: 'etc',
}

/**
 * 현행 휴직(`leave-of-absences/`)의 한 행입니다.
 *
 * 유급 여부는 수당이 있는지로 정합니다(새 API는 무급이면 수당이 없음). 새 휴직에는 만든·고친 시각이 없어 `created`·`updated`는 `null`입니다.
 */
export function toLegacyLeave(leave: Leave): Record<string, unknown> {
  return {
    id: leave.id,
    reason: REASON[leave.reason],
    start_date: leave.startDate,
    end_date: leave.endDate,
    expected_return_date: leave.expectedReturnDate,
    actual_return_date: leave.actualReturnDate ?? null,
    is_paid: leave.paidAllowance !== undefined,
    paid_allowance: leave.paidAllowance ?? null,
    include_in_service_years: leave.includeInServiceYears,
    nps_payment_exception: leave.npsPaymentException,
    nhis_notice_deferral: leave.nhisNoticeDeferral,
    created: null,
    updated: null,
  }
}

/** 현행 휴직 요약(`leave-of-absence-info/`)입니다. 새 요약의 휴직 ID를 휴직 행으로 채웁니다. */
export function toLegacyLeaveSummary(summary: LeaveSummary, leaves: readonly Leave[]): Record<string, unknown> {
  const row = (id: string | undefined) => {
    const leave = id === undefined ? undefined : leaves.find((candidate) => candidate.id === id)
    return leave === undefined ? null : toLegacyLeave(leave)
  }
  return {
    is_on_leave: summary.isOnLeave,
    current_leave: row(summary.currentLeaveId),
    upcoming_leave: row(summary.upcomingLeaveId),
    total_leave_days: summary.totalLeaveDays,
    parental_leave_days: summary.parentalLeaveDays,
    parental_leave_remaining_days: summary.parentalLeaveRemainingDays,
  }
}

/** 현행 휴직 본문을 바꾼 결과입니다. 새 등록에는 복직일이 없어 따로 둡니다(`:return`). */
export interface LegacyLeaveRequest {
  create: CreateLeave
  actualReturnDate: string | null
}

const LEGACY_REASONS = ['maternity', 'parental', 'illness', 'etc'] as const

/** 현행 휴직 본문(`POST`/`PUT leave-of-absences/`)을 읽습니다. 기본값은 현행 서버와 같습니다. */
export function fromLegacyLeave(body: Record<string, unknown>): LegacyLeaveRequest {
  const fields = new LegacyFields(body)
  const reason = fields.choice('reason', LEGACY_REASONS)
  const expectedReturnDate = fields.optionalDate('expected_return_date')
  const paidAllowance = fields.optionalNumber('paid_allowance')
  return {
    create: {
      reason: reason === 'etc' ? 'OTHER' : (reason.toUpperCase() as LeaveReason),
      startDate: fields.date('start_date'),
      endDate: fields.date('end_date'),
      ...(expectedReturnDate === null ? {} : { expectedReturnDate }),
      ...(fields.boolean('is_paid', false) ? { paid: paidAllowance === null ? {} : { allowance: paidAllowance } } : {}),
      includeInServiceYears: fields.boolean('include_in_service_years', false),
      npsPaymentException: fields.boolean('nps_payment_exception', false),
      nhisNoticeDeferral: fields.boolean('nhis_notice_deferral', false),
    },
    actualReturnDate: fields.optionalDate('actual_return_date'),
  }
}

/** 새 휴직 위반 필드 → 현행 필드입니다. */
export function leaveField(field: string): string {
  return field === 'paid.allowance' ? 'paid_allowance' : field
}

/**
 * 현행 `PUT`이 복직일 말고 다른 값을 바꾸는지 봅니다. 새 API는 휴직을 고치지 못하고 복직(`:return`)만 기록합니다.
 *
 * 현행 서버처럼 복직 예정일이 빠지면 지금 값을 유지한 것으로 보고, 육아휴직은 근속 포함을 늘 참으로 봅니다.
 */
export function changesBesidesReturn(current: Leave, next: CreateLeave): boolean {
  const parental = next.reason === 'PARENTAL'
  return (
    current.reason !== next.reason ||
    current.startDate !== next.startDate ||
    current.endDate !== next.endDate ||
    (next.expectedReturnDate !== undefined && current.expectedReturnDate !== next.expectedReturnDate) ||
    current.paidAllowance !== next.paid?.allowance ||
    current.includeInServiceYears !== (parental || next.includeInServiceYears === true) ||
    current.npsPaymentException !== (next.npsPaymentException === true) ||
    current.nhisNoticeDeferral !== (next.nhisNoticeDeferral === true)
  )
}
