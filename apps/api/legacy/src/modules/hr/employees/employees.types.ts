import type { z } from 'zod'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { commonInfoBody, createWageEmployeeBody, nonWageEmployeeBody, patchWageEmployeeBody } from './employees.schema'
import type { EmployeeKind } from '../shared/hr.types'
import type { IdentificationNumberType } from '../shared/registration-number'

/** A row of the `employees` table. */
export interface EmployeeRow {
  id: number
  company_id: string
  kind: EmployeeKind
  name: string
  english_name: string | null
  registration_number_enc: string | null
  registration_number_hash: string | null
  identification_number_type: IdentificationNumberType
  birth_date: string | null
  email: string | null
  phone: string | null
  is_local: 0 | 1
  nationality: string | null
  visa: string | null
  is_residence: 0 | 1
  country_of_residence: string
  employee_number: string | null
  department_id: number | null
  position_id: number | null
  join_date: string | null
  work_code: string | null
  is_rejoin: 0 | 1
  source: 'manual' | 'e_sign' | 'erp_import'
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Employment status of a wage employee, computed from dates rather than stored.
 *
 * An employee holds exactly one of `PRE_JOINED`, `JOINED`, `LEAVE` and
 * `RESIGNED`. `WORKING` is only a list filter: employed and not on leave,
 * which is the same set as `JOINED`.
 */
export type EmployeeStatus = 'PRE_JOINED' | 'WORKING' | 'JOINED' | 'LEAVE' | 'RESIGNED'

/** Summary of the contract that currently governs an employee. */
export type ContractTypeSummary = 'regular' | 'contract' | 'none'

/** Warning shown as the ▲ icon next to an employee's name. */
export type EmployeeWarning = 'missing_required_info' | 'contract_expiring_soon' | 'contract_expired' | 'indefinite_conversion_target'

/** An employee row joined with the values the list and detail views compute. */
export interface EmployeeView extends EmployeeRow {
  status: Exclude<EmployeeStatus, 'WORKING'>
  department_name: string | null
  position_name: string | null
  leave_date: string | null
  contract_type: 'regular' | 'contract' | null
  contract_end_date: string | null
  contract_followed: 0 | 1
}

/** Filters of the wage employee list, export and status counts. */
export interface EmployeeListFilter {
  statuses: EmployeeStatus[]
  search: string | null
  dateType: 'join_date' | 'leave_date' | 'birth_date' | null
  startDate: PlainDate | null
  endDate: PlainDate | null
  contractFilter: 'expiring_soon' | 'expired' | null
  ordering: string | null
}

/** Column values written when an employee is created or edited. */
export interface EmployeeWrite {
  name: string
  english_name: string | null
  registration_number_enc: string | null
  registration_number_hash: string | null
  identification_number_type: IdentificationNumberType
  birth_date: string | null
  email: string | null
  phone: string | null
  is_local: 0 | 1
  nationality: string | null
  visa: string | null
  is_residence: 0 | 1
  country_of_residence: string
  employee_number: string | null
  department_id: number | null
  position_id: number | null
  join_date: string | null
  work_code: string | null
  is_rejoin: 0 | 1
}

/** An employee as other domains read it, with the registration number left encrypted. */
export interface EmployeeRecord {
  id: number
  companyId: string
  kind: EmployeeKind
  name: string
  birthDate: PlainDate | null
  email: string | null
  phone: string | null
  isLocal: boolean
  isResidence: boolean
  nationality: string | null
  visa: string | null
  employeeNumber: string | null
  departmentId: number | null
  departmentName: string | null
  positionId: number | null
  positionName: string | null
  joinDate: PlainDate | null
  leaveDate: PlainDate | null
  workCode: string | null
  hasRegistrationNumber: boolean
}

/** Parsed body of `POST wage-employees`. */
export type CreateWageEmployeeInput = z.infer<typeof createWageEmployeeBody>

/** Parsed body of `PATCH wage-employees/:id`. */
export type PatchWageEmployeeInput = z.infer<typeof patchWageEmployeeBody>

/** Parsed body of `PUT wage-employees/:id/common-info`. */
export type CommonInfoInput = z.infer<typeof commonInfoBody>

/** Parsed body of the non-wage employee endpoints. */
export type NonWageEmployeeInput = z.infer<typeof nonWageEmployeeBody>
