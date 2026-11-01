import type { ServiceDeps } from '../../../app.types'
import { queryOne, transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findRetirementInfo } from '../retirement/retirement.repository'
import { HrError } from '../shared/hr-error'
import type { EmployeeKind } from '../shared/hr.types'
import { staleVersion, toFlag } from '../shared/hr.utils'
import { enqueueInsuranceFiling } from '../shared/insurance-filings.repository'
import {
  birthDateFromRegistrationNumber,
  type IdentificationNumberType,
  normalizeIdentificationNumber,
  protectIdentificationNumber,
} from '../shared/registration-number'
import {
  bumpEmployeeVersion,
  deleteEmployeeRow,
  findEmployeeRow,
  findEmployeesByRegistrationHash,
  findEmployeeView,
  insertEmployee,
  markOrganizationUsed,
  updateEmployee,
} from './employees.repository'
import type { CommonInfoInput, CreateWageEmployeeInput, EmployeeRow, EmployeeView, EmployeeWrite, PatchWageEmployeeInput } from './employees.types'

/** The identity fields a create or edit request may carry. */
export interface IdentityInput {
  registration_number?: string | undefined
  identification_number_type?: IdentificationNumberType | undefined
  birth_date?: PlainDate | null | undefined
}

type IdentityColumns = Pick<EmployeeWrite, 'registration_number_enc' | 'registration_number_hash' | 'identification_number_type' | 'birth_date'>

/**
 * Registers a wage employee (구성원 등록).
 *
 * The registration number is encrypted and hashed; a match with an employee
 * who has not resigned, or with a resigned one when `is_rejoin` is not set,
 * fails with `DUPLICATE_EMPLOYEE` (rule R2). A 취득 report is queued.
 */
export function createWageEmployee(deps: ServiceDeps, companyId: string, input: CreateWageEmployeeInput, userId: string): EmployeeView {
  const now = deps.clock.now()
  const today = deps.clock.today()
  return transaction(deps.db, () => {
    assertOrganization(deps, companyId, input.department, input.position)
    const isRejoin = input.is_rejoin ?? false
    const identity = resolveIdentity(deps, companyId, 'wage-salary', null, input, null, isRejoin)
    const values: EmployeeWrite = {
      name: input.name,
      english_name: input.english_name,
      registration_number_enc: identity.registration_number_enc ?? null,
      registration_number_hash: identity.registration_number_hash ?? null,
      identification_number_type: identity.identification_number_type ?? 'registration',
      birth_date: identity.birth_date ?? null,
      email: emptyToNull(input.email),
      phone: input.phone,
      is_local: toFlag(input.is_local ?? true),
      nationality: input.nationality,
      visa: input.visa,
      is_residence: toFlag(input.is_residence ?? true),
      country_of_residence: input.country_of_residence ?? '대한민국',
      employee_number: input.employee_number,
      department_id: input.department,
      position_id: input.position,
      join_date: input.join_date,
      work_code: input.work_code,
      is_rejoin: toFlag(isRejoin),
    }
    const id = insertEmployee(deps.db, companyId, 'wage-salary', values, 'manual', userId, now)
    markOrganizationUsed(deps.db, companyId, input.department, input.position)
    enqueueInsuranceFiling(deps.db, {
      companyId,
      employeeId: id,
      kind: 'join',
      sourceType: 'employee',
      sourceId: id,
      payload: { join_date: input.join_date, work_code: input.work_code },
      now,
    })
    return requireView(deps, companyId, id, today)
  })
}

/** Applies a partial edit to a wage employee's basic information (last write wins). */
export function patchWageEmployee(deps: ServiceDeps, employee: EmployeeRow, input: PatchWageEmployeeInput): EmployeeView {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const values: Partial<EmployeeWrite> = {}
    if (input.department !== undefined || 'department' in input) {
      assertOrganization(deps, employee.company_id, input.department ?? null, null)
      values.department_id = input.department ?? null
    }
    if (input.position !== undefined || 'position' in input) {
      assertOrganization(deps, employee.company_id, null, input.position ?? null)
      values.position_id = input.position ?? null
    }
    Object.assign(values, commonColumns(input))
    if (input.join_date !== undefined) values.join_date = input.join_date
    if ('work_code' in input) values.work_code = input.work_code ?? null
    if ('employee_number' in input) values.employee_number = input.employee_number ?? null
    Object.assign(values, resolveIdentity(deps, employee.company_id, employee.kind, employee.id, input, employee, employee.is_rejoin === 1))
    updateEmployee(deps.db, employee.company_id, employee.id, values, now)
    markOrganizationUsed(deps.db, employee.company_id, values.department_id ?? null, values.position_id ?? null)
    return requireView(deps, employee.company_id, employee.id, deps.clock.today())
  })
}

/** Replaces an employee's person-level fields (`common-info`), keeping the stored number when a masked one is sent back. */
export function putCommonInfo(deps: ServiceDeps, employee: EmployeeRow, input: CommonInfoInput): EmployeeView {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const values: Partial<EmployeeWrite> = {
      name: input.name,
      english_name: input.english_name,
      email: emptyToNull(input.email),
      phone: input.phone,
      is_local: toFlag(input.is_local ?? true),
      nationality: input.nationality,
      visa: input.visa,
      is_residence: toFlag(input.is_residence ?? true),
      country_of_residence: input.country_of_residence ?? '대한민국',
      ...resolveIdentity(deps, employee.company_id, employee.kind, employee.id, input, employee, employee.is_rejoin === 1),
    }
    updateEmployee(deps.db, employee.company_id, employee.id, values, now)
    return requireView(deps, employee.company_id, employee.id, deps.clock.today())
  })
}

/**
 * Deletes an employee and every sub-resource.
 *
 * @throws {HrError} `RETIREMENT_COMPLETED` when the severance settlement is completed (rule R3).
 */
export function deleteEmployee(deps: ServiceDeps, employee: EmployeeRow): void {
  transaction(deps.db, () => {
    const retirement = findRetirementInfo(deps.db, employee.company_id, employee.id)
    if (retirement?.severance_settlement_status === 'completed') {
      throw new HrError('RETIREMENT_COMPLETED', 'Employees whose severance settlement is completed cannot be deleted.')
    }
    deleteEmployeeRow(deps.db, employee.company_id, employee.id)
  })
}

/**
 * Bumps the employee version for a status-changing write.
 *
 * @throws {DomainError} `VERSION_CONFLICT` when `expectedVersion` is stale, `NOT_FOUND` when the employee was deleted.
 */
export function advanceEmployeeVersion(deps: ServiceDeps, employee: EmployeeRow, expectedVersion: number, now: string): number {
  if (!bumpEmployeeVersion(deps.db, employee.company_id, employee.id, expectedVersion, now)) {
    if (findEmployeeRow(deps.db, employee.company_id, employee.id) === undefined) throw notFound('Employee')
    throw staleVersion('employee')
  }
  return expectedVersion + 1
}

/**
 * Encrypts, hashes and checks a new registration number, or keeps the stored one.
 *
 * A value containing `*` is the masked form the API returned and means "unchanged".
 *
 * @throws {HrError} `DUPLICATE_EMPLOYEE` with `duplicate_employee_id` when another employee of the same kind has the number.
 */
export function resolveIdentity(
  deps: ServiceDeps,
  companyId: string,
  kind: EmployeeKind,
  selfId: number | null,
  input: IdentityInput,
  existing: EmployeeRow | null,
  isRejoin: boolean,
): Partial<IdentityColumns> {
  const type = input.identification_number_type ?? existing?.identification_number_type ?? 'registration'
  const raw = input.registration_number
  const result: Partial<IdentityColumns> = {}
  if (input.identification_number_type !== undefined) result.identification_number_type = type
  if (input.birth_date !== undefined) result.birth_date = input.birth_date
  if (raw !== undefined && raw !== '' && !raw.includes('*')) {
    const normalized = normalizeIdentificationNumber(raw, type)
    if (normalized === null) {
      throw invalidField('registration_number', type === 'passport' ? 'Enter a valid passport number.' : 'Enter a valid 13-digit registration number.')
    }
    const protectedNumber = protectIdentificationNumber(deps.db, deps.cipher, normalized, deps.clock.now())
    assertNotDuplicate(deps, companyId, kind, selfId, protectedNumber.hash, isRejoin)
    result.registration_number_enc = protectedNumber.encrypted
    result.registration_number_hash = protectedNumber.hash
    result.identification_number_type = type
    if (type === 'registration' && input.birth_date == null) result.birth_date = birthDateFromRegistrationNumber(normalized)
  } else if (raw === '' && existing === null) {
    throw invalidField('registration_number', 'This field is required.')
  }
  const birthDate = result.birth_date !== undefined ? result.birth_date : (existing?.birth_date ?? null)
  if (type === 'passport' && birthDate === null) throw invalidField('birth_date', 'Enter the birth date for passport holders.')
  return result
}

function assertNotDuplicate(deps: ServiceDeps, companyId: string, kind: EmployeeKind, selfId: number | null, hash: string, isRejoin: boolean): void {
  const matches = findEmployeesByRegistrationHash(deps.db, companyId, kind, hash, deps.clock.today()).filter((match) => match.id !== selfId)
  const blocking = matches.find((match) => match.status !== 'RESIGNED' || !isRejoin)
  if (blocking !== undefined) {
    throw new HrError('DUPLICATE_EMPLOYEE', 'An employee with this registration number already exists.', { duplicate_employee_id: blocking.id })
  }
}

/**
 * Checks that the referenced department and position belong to the company.
 *
 * @throws {DomainError} `VALIDATION_FAILED` naming the unknown reference.
 */
export function assertOrganization(deps: ServiceDeps, companyId: string, departmentId: number | null, positionId: number | null): void {
  if (departmentId !== null && queryOne(deps.db, 'SELECT 1 AS found FROM departments WHERE company_id = ? AND id = ?', [companyId, departmentId]) === undefined) {
    throw invalidField('department', 'Unknown department.')
  }
  if (positionId !== null && queryOne(deps.db, 'SELECT 1 AS found FROM positions WHERE company_id = ? AND id = ?', [companyId, positionId]) === undefined) {
    throw invalidField('position', 'Unknown position.')
  }
}

/** Picks the person-level columns present in an edit body, leaving absent fields untouched. */
export function commonColumns(input: Partial<CommonInfoInput>): Partial<EmployeeWrite> {
  const values: Partial<EmployeeWrite> = {}
  if (input.name !== undefined) values.name = input.name
  if ('english_name' in input) values.english_name = input.english_name ?? null
  if ('email' in input) values.email = emptyToNull(input.email)
  if ('phone' in input) values.phone = input.phone ?? null
  if (input.is_local !== undefined) values.is_local = toFlag(input.is_local)
  if ('nationality' in input) values.nationality = input.nationality ?? null
  if ('visa' in input) values.visa = input.visa ?? null
  if (input.is_residence !== undefined) values.is_residence = toFlag(input.is_residence)
  if (input.country_of_residence !== undefined) values.country_of_residence = input.country_of_residence
  return values
}

function requireView(deps: ServiceDeps, companyId: string, employeeId: number, today: PlainDate): EmployeeView {
  const view = findEmployeeView(deps.db, companyId, employeeId, today)
  if (view === undefined) throw notFound('Employee')
  return view
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value
}
