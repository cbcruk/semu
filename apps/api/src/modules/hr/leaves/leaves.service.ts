import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { addDays, addMonths, daysBetween, minDate } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { advanceEmployeeVersion as bump } from '../employees/employees.service'
import type { EmployeeRow } from '../employees/employees.types'
import { findRetirementInfo } from '../retirement/retirement.repository'
import { HrError } from '../shared/hr-error'
import { toFlag } from '../shared/hr.utils'
import { enqueueInsuranceFiling, withdrawInsuranceFilings } from '../shared/insurance-filings.repository'
import { deleteLeave, findLeave, insertLeave, listAllLeaves, updateLeave } from './leaves.repository'
import type { LeaveInput, LeaveRow, LeaveSummary, LeaveWrite } from './leaves.types'

/** Statutory parental leave per child in days (남녀고용평등법 제19조: one year). */
export const PARENTAL_LEAVE_DAYS = 365

/**
 * Registers a leave of absence, which changes the employee's status, and queues the 휴직 report (rule R15).
 *
 * @param expectedVersion The employee version from `If-Match`.
 * @throws {HrError} `LEAVE_OVERLAP` when the period overlaps another leave.
 */
export function createLeave(deps: ServiceDeps, employee: EmployeeRow, input: LeaveInput, expectedVersion: number): { leave: LeaveRow; version: number } {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const values = toWrite(deps, employee, input, null)
    bump(deps, employee, expectedVersion, now)
    const id = insertLeave(deps.db, employee.company_id, employee.id, values, now)
    enqueueInsuranceFiling(deps.db, {
      companyId: employee.company_id,
      employeeId: employee.id,
      kind: 'leave_of_absence',
      sourceType: 'leave',
      sourceId: id,
      payload: { reason: values.reason, start_date: values.start_date, end_date: values.end_date, nps_payment_exception: values.nps_payment_exception === 1 },
      now,
    })
    if (values.actual_return_date !== null) queueReinstatement(deps, employee, id, values.actual_return_date, now)
    return { leave: requireLeave(deps, employee, id), version: expectedVersion + 1 }
  })
}

/** Replaces a leave; setting `actual_return_date` records the return to work and queues the 복직 report. */
export function replaceLeave(
  deps: ServiceDeps,
  employee: EmployeeRow,
  leaveId: number,
  input: LeaveInput,
  expectedVersion: number,
): { leave: LeaveRow; version: number } {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const current = requireLeave(deps, employee, leaveId)
    const values = toWrite(deps, employee, input, leaveId)
    bump(deps, employee, expectedVersion, now)
    updateLeave(deps.db, employee.company_id, leaveId, values, now)
    if (values.actual_return_date !== null && values.actual_return_date !== current.actual_return_date) {
      queueReinstatement(deps, employee, leaveId, values.actual_return_date, now)
    }
    if (values.actual_return_date === null && current.actual_return_date !== null) {
      withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'reinstatement', 'leave', leaveId, now)
    }
    return { leave: requireLeave(deps, employee, leaveId), version: expectedVersion + 1 }
  })
}

/** Deletes a leave and withdraws its pending reports. */
export function removeLeave(deps: ServiceDeps, employee: EmployeeRow, leaveId: number, expectedVersion: number): void {
  const now = deps.clock.now()
  transaction(deps.db, () => {
    requireLeave(deps, employee, leaveId)
    bump(deps, employee, expectedVersion, now)
    withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'leave_of_absence', 'leave', leaveId, now)
    withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'reinstatement', 'leave', leaveId, now)
    deleteLeave(deps.db, employee.company_id, employee.id, leaveId)
  })
}

/** Summarises an employee's leaves on a date. */
export function summarizeLeaves(deps: ServiceDeps, employee: EmployeeRow, today: PlainDate): LeaveSummary {
  const leaves = listAllLeaves(deps.db, employee.company_id, employee.id)
  const lastDay = (leave: LeaveRow): PlainDate =>
    leave.actual_return_date === null ? (leave.end_date as PlainDate) : addDays(leave.actual_return_date as PlainDate, -1)
  const elapsed = (leave: LeaveRow): number => {
    if (leave.start_date > today) return 0
    return daysBetween(leave.start_date as PlainDate, minDate(lastDay(leave), today)) + 1
  }
  const current = leaves.find((leave) => leave.start_date <= today && lastDay(leave) >= today) ?? null
  const parental = leaves.filter((leave) => leave.reason === 'parental').reduce((total, leave) => total + daysBetween(leave.start_date as PlainDate, lastDay(leave)) + 1, 0)
  return {
    is_on_leave: current !== null,
    current_leave: current,
    upcoming_leave: leaves.find((leave) => leave.start_date > today) ?? null,
    total_leave_days: leaves.reduce((total, leave) => total + elapsed(leave), 0),
    parental_leave_days: parental,
    parental_leave_remaining_days: Math.max(0, PARENTAL_LEAVE_DAYS - parental),
  }
}

/** Loads a leave of the employee or fails with `NOT_FOUND`. */
export function requireLeave(deps: ServiceDeps, employee: EmployeeRow, leaveId: number): LeaveRow {
  const leave = findLeave(deps.db, employee.company_id, employee.id, leaveId)
  if (leave === undefined) throw notFound('Leave of absence')
  return leave
}

function toWrite(deps: ServiceDeps, employee: EmployeeRow, input: LeaveInput, selfId: number | null): LeaveWrite {
  if (input.start_date > input.end_date) throw invalidField('end_date', 'The end date must not be before the start date.')
  if (employee.join_date !== null && input.start_date < employee.join_date) throw invalidField('start_date', 'A leave cannot start before the join date.')
  const leaveDate = findRetirementInfo(deps.db, employee.company_id, employee.id)?.leave_date ?? null
  if (leaveDate !== null && input.end_date > leaveDate) throw invalidField('end_date', 'A leave cannot end after the leave date.')
  if (input.is_paid && input.paid_allowance === null) throw invalidField('paid_allowance', 'Enter the paid leave allowance.')
  if (input.actual_return_date !== null && (input.actual_return_date <= input.start_date || input.actual_return_date > addDays(input.end_date, 1))) {
    throw invalidField('actual_return_date', 'The return date must fall after the start and no later than the day after the end.')
  }
  if (input.nhis_notice_deferral && addMonths(input.start_date, 1) > addDays(input.end_date, 1)) {
    throw invalidField('nhis_notice_deferral', 'Health insurance deferral needs a leave of one month or longer.')
  }
  const overlapping = listAllLeaves(deps.db, employee.company_id, employee.id).find(
    (other) => other.id !== selfId && other.start_date <= input.end_date && (other.actual_return_date === null ? other.end_date : addDays(other.actual_return_date as PlainDate, -1)) >= input.start_date,
  )
  if (overlapping !== undefined) throw new HrError('LEAVE_OVERLAP', 'The period overlaps another leave of absence.', { overlapping_leave_id: overlapping.id })
  return {
    reason: input.reason,
    start_date: input.start_date,
    end_date: input.end_date,
    expected_return_date: input.expected_return_date ?? addDays(input.end_date, 1),
    actual_return_date: input.actual_return_date,
    is_paid: toFlag(input.is_paid),
    paid_allowance: input.is_paid ? input.paid_allowance : null,
    include_in_service_years: toFlag(input.reason === 'parental' || input.include_in_service_years),
    nps_payment_exception: toFlag(input.nps_payment_exception),
    nhis_notice_deferral: toFlag(input.nhis_notice_deferral),
  }
}

function queueReinstatement(deps: ServiceDeps, employee: EmployeeRow, leaveId: number, returnDate: string, now: string): void {
  enqueueInsuranceFiling(deps.db, {
    companyId: employee.company_id,
    employeeId: employee.id,
    kind: 'reinstatement',
    sourceType: 'leave',
    sourceId: leaveId,
    payload: { return_date: returnDate },
    now,
  })
}
