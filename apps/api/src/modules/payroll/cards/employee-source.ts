/**
 * Reads HR employees into payroll rows, only through HR's employee repository contract.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { Cipher } from '../../../lib/crypto/crypto.types'
import { addDays, daysBetween } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import {
  countDependantsAsOf,
  findDeductionInfoAsOf,
  findPayrollContractAsOf,
  findSocialInsuranceAsOf,
  findWorkContractAsOf,
  listLeavesOverlapping,
} from '../../hr/employees/employees.repository'
import type { EmployeeRecord } from '../../hr/employees/employees.types'
import type { PayrollIncomeType } from '../engine/engine.types'
import { monthlyStandardHours, weeklyRestHours } from '../engine/working-time'
import { findWorkSchedulePolicy, listWorkSchedulePolicies } from '../settings/settings.repository'
import { policyFieldsOf, scheduleHours } from '../settings/settings.utils'
import type { BusinessInputData, CardRow, DailyInputData, EmployeeSnapshot, ItemAmount, OtherInputData, RowWrite, WageInputData } from './cards.types'
import { EMPTY_WORK } from './cards.utils'
import { DEFAULT_SNAPSHOT } from './row-calculation'

/** The wage income type an employee's payroll contract implies on a date (월급·일급·시급). */
export function wageIncomeTypeOf(db: DatabaseSync, cipher: Cipher, companyId: string, employeeId: number, asOf: PlainDate): PayrollIncomeType {
  const contract = findPayrollContractAsOf(db, cipher, companyId, employeeId, asOf)
  if (contract?.wage_type === 'hourly') return 'wage_hourly'
  if (contract?.wage_type === 'daily') return 'wage_daily'
  return 'wage_monthly'
}

/**
 * Builds the HR snapshot of a wage row as of the end of the card's period.
 *
 * Hours come from the employee's work schedule policy, or the contract's
 * weekly hours, or the company's first active policy, in that order.
 */
export function snapshotOf(db: DatabaseSync, companyId: string, employeeId: number, asOf: PlainDate): EmployeeSnapshot {
  const deduction = findDeductionInfoAsOf(db, companyId, employeeId, asOf)
  const dependants = countDependantsAsOf(db, companyId, employeeId, asOf)
  const insurance = findSocialInsuranceAsOf(db, companyId, employeeId, asOf)
  const hours = hoursOf(db, companyId, employeeId, asOf)
  return {
    dependants: dependants.dependents_count,
    children_8_to_20: dependants.children_8_to_20_count,
    withholding_ratio: deduction?.income_tax_rate ?? 100,
    income_tax_method: deduction?.income_tax_calc_method ?? 'tax_table_based',
    manual_income_tax: deduction?.manual_income_tax ?? null,
    insurance_enrolled: {
      national_pension: insurance === undefined || insurance.nps_enrolled === 1,
      health_insurance: insurance === undefined || insurance.nhis_enrolled === 1,
      employment_insurance: insurance === undefined || insurance.ei_enrolled === 1,
    },
    monthly_standard_hours: hours.monthly,
    daily_rest_hours: hours.dailyRest,
  }
}

/**
 * Counts the paid days of an employee within a card's period.
 *
 * Days before joining, after leaving and on unpaid leave are excluded.
 *
 * @returns `null` when the whole period is paid, so no proration applies.
 */
export function prorationOf(db: DatabaseSync, card: CardRow, employee: EmployeeRecord): WageInputData['proration'] {
  const totalDays = daysBetween(card.period_start, card.period_end) + 1
  const from = employee.joinDate !== null && employee.joinDate > card.period_start ? employee.joinDate : card.period_start
  const to = employee.leaveDate !== null && employee.leaveDate < card.period_end ? employee.leaveDate : card.period_end
  let payable = to < from ? 0 : daysBetween(from, to) + 1
  for (const leave of listLeavesOverlapping(db, card.company_id, employee.id, card.period_start, card.period_end)) {
    if (leave.is_paid === 1) continue
    const leaveFrom = leave.start_date > from ? (leave.start_date as PlainDate) : from
    const leaveEnd = leave.actual_return_date !== null ? addDays(leave.actual_return_date as PlainDate, -1) : (leave.end_date as PlainDate)
    const leaveTo = leaveEnd < to ? leaveEnd : to
    if (leaveTo >= leaveFrom) payable -= daysBetween(leaveFrom, leaveTo) + 1
  }
  payable = Math.max(0, payable)
  return payable >= totalDays ? null : { payable_days: payable, total_days: totalDays }
}

/** Status label of an employee within a card's period: 신규입사, 퇴사, 휴직 or 재직. */
export function statusLabelOf(db: DatabaseSync, card: CardRow, employee: EmployeeRecord): string {
  if (employee.leaveDate !== null && employee.leaveDate >= card.period_start && employee.leaveDate <= card.period_end) return '퇴사'
  if (employee.joinDate !== null && employee.joinDate >= card.period_start && employee.joinDate <= card.period_end) return '신규입사'
  if (listLeavesOverlapping(db, card.company_id, employee.id, card.period_start, card.period_end).length > 0) return '휴직'
  return '재직'
}

/** Builds a new wage row for an employee from the payroll contract in force at the end of the period. */
export function wageRowOf(db: DatabaseSync, cipher: Cipher, card: CardRow, employee: EmployeeRecord, incomeType: PayrollIncomeType): RowWrite {
  const contract = findPayrollContractAsOf(db, cipher, card.company_id, employee.id, card.period_end)
  const proration = prorationOf(db, card, employee)
  const items: ItemAmount[] = (contract?.payment_items ?? []).flatMap((item) =>
    item.is_enabled && typeof item.payment_item === 'number' ? [{ item_id: item.payment_item, amount: item.amount }] : [],
  )
  const input: WageInputData = {
    base_pay: incomeType === 'wage_monthly' ? (contract === undefined ? 0 : contract.base_salary > 0 ? contract.base_salary : contract.amount) : 0,
    hourly_wage: incomeType === 'wage_hourly' ? (contract?.base_hourly_wage || contract?.amount || 0) : 0,
    daily_wage: incomeType === 'wage_daily' ? (contract?.amount ?? 0) : 0,
    worked_days: 0,
    prorate_requested: proration !== null,
    proration,
    payment_items: items,
    deduction_items: [],
    work: { ...EMPTY_WORK },
    insurance_notice: {},
  }
  return {
    ...personalOf(employee, card.payment_date),
    income_type: incomeType,
    employment_status_label: statusLabelOf(db, card, employee),
    input,
    snapshot: snapshotOf(db, card.company_id, employee.id, card.period_end),
  }
}

/** Builds a new daily, business or other income row for a non-wage employee. */
export function simpleRowOf(card: CardRow, employee: EmployeeRecord, incomeType: 'daily' | 'business' | 'other'): RowWrite {
  return {
    ...personalOf(employee, card.payment_date),
    income_type: incomeType,
    employment_status_label: null,
    input: emptySimpleInput(incomeType),
    snapshot: {},
  }
}

/** The empty input of a daily, business or other income row. */
export function emptySimpleInput(incomeType: 'daily' | 'business' | 'other'): DailyInputData | BusinessInputData | OtherInputData {
  if (incomeType === 'daily') {
    return { pay_amount: 0, work_dates: [], work_days: null, avg_daily_hours: null, is_owner_or_cohabiting_relative: false, deduction_items: [] }
  }
  if (incomeType === 'business') {
    return {
      pay_amount: 0,
      business_income_type_code: null,
      detail_type: null,
      employment_insurance_applicable: false,
      contract_type: null,
      short_term_work_dates: [],
      special_occ_type_code: null,
      tax_deduction_mode: 'before_tax',
    }
  }
  return { pay_amount: 0, other_income_type_code: null, tax_deduction_mode: 'before_tax', necessary_expense_amount: null }
}

/** Personal columns copied from an employee onto a row. */
export function personalOf(employee: EmployeeRecord, paymentDate: PlainDate): Omit<RowWrite, 'income_type' | 'employment_status_label' | 'input' | 'snapshot'> {
  return {
    employee_id: employee.id,
    name: employee.name,
    registration_number_enc: null,
    is_foreigner: employee.isLocal ? 0 : 1,
    residence_country: employee.isResidence ? 'KR' : (employee.nationality ?? 'KR'),
    payment_date: paymentDate,
    birth_date: employee.birthDate,
    department_name: employee.departmentName,
    email: employee.email,
  }
}

function hoursOf(db: DatabaseSync, companyId: string, employeeId: number, asOf: PlainDate): { monthly: number; dailyRest: number } {
  const contract = findWorkContractAsOf(db, companyId, employeeId, asOf)
  const policyId = contract?.work_schedule_policy_id ?? null
  const policy = policyId === null ? undefined : findWorkSchedulePolicy(db, companyId, policyId)
  if (policy !== undefined) return fromPolicy(scheduleHours(policyFieldsOf(policy)))
  if (contract?.weekly_work_hours !== null && contract?.weekly_work_hours !== undefined) {
    const weekly = contract.weekly_work_hours
    const days = Math.min(5, Math.max(1, Math.ceil(weekly / 8)))
    const rest = weeklyRestHours(weekly, { workDaysPerWeek: days })
    return { monthly: monthlyStandardHours(weekly, rest), dailyRest: rest }
  }
  const fallback = listWorkSchedulePolicies(db, companyId, true, 1, 0).rows[0]
  if (fallback !== undefined) return fromPolicy(scheduleHours(policyFieldsOf(fallback)))
  return { monthly: DEFAULT_SNAPSHOT.monthly_standard_hours, dailyRest: DEFAULT_SNAPSHOT.daily_rest_hours }
}

function fromPolicy(hours: { monthlyStandardHours: number; weeklyRestHours: number }): { monthly: number; dailyRest: number } {
  return { monthly: hours.monthlyStandardHours, dailyRest: hours.weeklyRestHours }
}
