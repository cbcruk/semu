import type { EmployeeView } from '../employees/employees.types'
import type { InsuranceFilingKind } from '../shared/insurance-filings.repository'

/** Korean employment status of the legacy 직원 관리 list. */
export type LegacyEmploymentStatus = '재직' | '휴직' | '퇴사' | '임시저장' | '입사처리중' | '퇴사처리중' | '휴직처리중'

/**
 * Derives the legacy `employment_status` of an employee (state machine §3.2).
 *
 * An employee without a registration number is 임시저장. An open 4대보험
 * report turns the status into its 처리중 form, a resignation report taking
 * precedence over a leave report and a leave report over a join report.
 * Otherwise the computed status maps to 재직, 휴직 or 퇴사; employees who
 * have not joined yet count as 재직, as the legacy list has no such state.
 *
 * @param pendingKinds Kinds of the employee's 4대보험 reports still pending.
 */
export function legacyEmploymentStatus(view: Pick<EmployeeView, 'registration_number_enc' | 'status'>, pendingKinds: ReadonlySet<InsuranceFilingKind>): LegacyEmploymentStatus {
  if (view.registration_number_enc === null) return '임시저장'
  if (pendingKinds.has('leave')) return '퇴사처리중'
  if (pendingKinds.has('leave_of_absence')) return '휴직처리중'
  if (pendingKinds.has('join')) return '입사처리중'
  switch (view.status) {
    case 'LEAVE':
      return '휴직'
    case 'RESIGNED':
      return '퇴사'
    default:
      return '재직'
  }
}
