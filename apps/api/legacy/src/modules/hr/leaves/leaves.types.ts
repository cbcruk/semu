import type { z } from 'zod'
import type { leaveBody } from './leaves.schema'

/** Parsed body of `POST`/`PUT leave-of-absences`. */
export type LeaveInput = z.infer<typeof leaveBody>

/** Reason for a leave of absence. */
export type LeaveReason = 'maternity' | 'parental' | 'illness' | 'etc'

/** A row of `employee_leaves`. */
export interface LeaveRow {
  id: number
  company_id: string
  employee_id: number
  reason: LeaveReason
  start_date: string
  end_date: string
  expected_return_date: string | null
  actual_return_date: string | null
  is_paid: 0 | 1
  paid_allowance: number | null
  include_in_service_years: 0 | 1
  nps_payment_exception: 0 | 1
  nhis_notice_deferral: 0 | 1
  created_at: string
  updated_at: string
}

/** Summary of an employee's leave history shown on the detail page. */
export interface LeaveSummary {
  is_on_leave: boolean
  current_leave: LeaveRow | null
  upcoming_leave: LeaveRow | null
  total_leave_days: number
  parental_leave_days: number
  parental_leave_remaining_days: number
}

/** Values written to a leave. */
export type LeaveWrite = Omit<LeaveRow, 'id' | 'company_id' | 'employee_id' | 'created_at' | 'updated_at'>
