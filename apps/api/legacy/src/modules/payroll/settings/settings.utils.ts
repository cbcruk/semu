import { sum } from '../engine/engine.utils'
import { monthlyStandardHours, weeklyRestHours } from '../engine/working-time'
import type { ScheduleHours, WorkSchedulePolicyFields, WorkSchedulePolicyRow } from './settings.types'

/** Number of weeks in a contractual schedule cycle; monthly cycles count the distinct weeks they define. */
export function cycleWeeks(fields: Pick<WorkSchedulePolicyFields, 'contractual_work_schedule_type' | 'contractual_work_schedules'>): number {
  switch (fields.contractual_work_schedule_type) {
    case 'weekly':
      return 1
    case 'biweekly':
      return 2
    case 'monthly':
      return Math.max(1, new Set(fields.contractual_work_schedules.map((entry) => entry.week)).size)
  }
}

/**
 * Derives weekly contractual hours, work days, 1일 주휴시간 and 월 소정근로시간 from a schedule.
 *
 * Weekly hours average the cycle. Automatic weekly rest uses the
 * proportional rule of {@linkcode weeklyRestHours}; manual input is taken as is.
 */
export function scheduleHours(fields: WorkSchedulePolicyFields): ScheduleHours {
  const weeks = cycleWeeks(fields)
  const weeklyContractualHours = round2(sum(fields.contractual_work_schedules.map((entry) => entry.hours)) / weeks)
  const workDaysPerWeek = round2(fields.contractual_work_schedules.filter((entry) => entry.hours > 0).length / weeks)
  const rest =
    fields.weekly_rest_hours_input_method === 'manual'
      ? (fields.weekly_rest_hours ?? 0)
      : weeklyRestHours(weeklyContractualHours, { workDaysPerWeek })
  return {
    weeklyContractualHours,
    workDaysPerWeek,
    weeklyRestHours: rest,
    monthlyStandardHours: monthlyStandardHours(weeklyContractualHours, rest),
  }
}

/** Parses a stored work schedule policy row into its editable fields. */
export function policyFieldsOf(row: WorkSchedulePolicyRow): WorkSchedulePolicyFields {
  return {
    name: row.name,
    paid_weekly_holidays: JSON.parse(row.paid_weekly_holidays) as number[],
    unpaid_holidays: JSON.parse(row.unpaid_holidays) as number[],
    contractual_work_schedule_type: row.contractual_work_schedule_type,
    contractual_work_schedules: JSON.parse(row.contractual_work_schedules) as WorkSchedulePolicyFields['contractual_work_schedules'],
    weekly_rest_hours_input_method: row.weekly_rest_hours_input_method,
    weekly_rest_hours: row.weekly_rest_hours_x100 === null ? null : row.weekly_rest_hours_x100 / 100,
    fixed_overtime_work_schedule_type: row.fixed_overtime_work_schedule_type,
    fixed_overtime_input_type: row.fixed_overtime_input_type,
    fixed_overtime_items: JSON.parse(row.fixed_overtime_items) as WorkSchedulePolicyFields['fixed_overtime_items'],
    is_active: row.is_active === 1,
  }
}

/** Converts a multiplier such as `1.5` to the stored hundredths. */
export function toX100(multiplier: number): number {
  return Math.round(multiplier * 100)
}

/** Converts stored hundredths back to a multiplier. */
export function fromX100(value: number): number {
  return value / 100
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
