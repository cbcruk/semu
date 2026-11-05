import { addDays } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { EmployeeRecord, EmployeeStatus, EmployeeView, EmployeeWarning } from './employees.types'

const STATUS_BY_CODE: Record<string, EmployeeStatus> = {
  '1': 'PRE_JOINED',
  '2': 'WORKING',
  '3': 'JOINED',
  '4': 'LEAVE',
  '5': 'RESIGNED',
}

/** Integer code of each status, as the client sends it in `?status=`. */
export const STATUS_CODE: Record<EmployeeStatus, number> = {
  PRE_JOINED: 1,
  WORKING: 2,
  JOINED: 3,
  LEAVE: 4,
  RESIGNED: 5,
}

/** Korean label of each stored status, matching the list tabs. */
export const STATUS_LABEL: Record<Exclude<EmployeeStatus, 'WORKING'>, string> = {
  PRE_JOINED: '입사예정',
  JOINED: '재직',
  LEAVE: '휴직',
  RESIGNED: '퇴직',
}

/**
 * Parses the comma-separated `status` query parameter.
 *
 * Accepts the integer codes the client sends (`1`–`5`) as well as the status names.
 *
 * @returns The statuses, or `null` when any entry is unknown.
 */
export function parseStatusParam(value: string | undefined): EmployeeStatus[] | null {
  if (value === undefined || value.trim() === '') return []
  const statuses: EmployeeStatus[] = []
  for (const part of value.split(',')) {
    const key = part.trim().toUpperCase()
    const status = STATUS_BY_CODE[key] ?? (Object.hasOwn(STATUS_CODE, key) ? (key as EmployeeStatus) : undefined)
    if (status === undefined) return null
    statuses.push(status)
  }
  return statuses
}

/**
 * Lists the warnings behind an employee's ▲ icon.
 *
 * @param indefiniteTarget Whether the employee's fixed-term contracts exceed or approach two years.
 * @param warningDays Days before a contract end that count as expiring soon.
 */
export function employeeWarnings(view: EmployeeView, today: PlainDate, indefiniteTarget: boolean, warningDays: number): EmployeeWarning[] {
  const warnings: EmployeeWarning[] = []
  if (view.kind === 'wage-salary' && view.registration_number_enc === null) warnings.push('missing_required_info')
  if (view.status !== 'RESIGNED' && view.contract_type === 'contract' && view.contract_end_date !== null) {
    if (view.contract_end_date < today && view.contract_followed === 0) warnings.push('contract_expired')
    else if (view.contract_end_date >= today && view.contract_end_date <= addDays(today, warningDays)) warnings.push('contract_expiring_soon')
  }
  if (view.status !== 'RESIGNED' && indefiniteTarget) warnings.push('indefinite_conversion_target')
  return warnings
}

/** Converts a view row into the record shape other domains read. */
export function toEmployeeRecord(view: EmployeeView): EmployeeRecord {
  return {
    id: view.id,
    companyId: view.company_id,
    kind: view.kind,
    name: view.name,
    birthDate: view.birth_date as PlainDate | null,
    email: view.email,
    phone: view.phone,
    isLocal: view.is_local === 1,
    isResidence: view.is_residence === 1,
    nationality: view.nationality,
    visa: view.visa,
    employeeNumber: view.employee_number,
    departmentId: view.department_id,
    departmentName: view.department_name,
    positionId: view.position_id,
    positionName: view.position_name,
    joinDate: view.join_date as PlainDate | null,
    leaveDate: view.leave_date as PlainDate | null,
    workCode: view.work_code,
    hasRegistrationNumber: view.registration_number_enc !== null,
  }
}

/** Computes full years of age on a date (만 나이). */
export function ageOn(birthDate: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(birthDate.slice(0, 4))
  return date.slice(5) < birthDate.slice(5) ? years - 1 : years
}
