import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { findEmployeeView, insertEmployee, markOrganizationUsed, updateEmployee } from '../employees/employees.repository'
import { assertOrganization, commonColumns, resolveIdentity } from '../employees/employees.service'
import type { EmployeeRow, EmployeeView, EmployeeWrite, NonWageEmployeeInput } from '../employees/employees.types'
import { toFlag } from '../shared/hr.utils'
import { saveNonWageDetail } from './non-wage.repository'
import type { NonWageDetailWrite, NonWageKind } from './non-wage.types'

/**
 * Registers a daily, business or other income earner (신규 설계).
 *
 * The bundle only edits these kinds; payroll cards create them in the
 * original product. A registration number is optional here, and a given one
 * is checked for duplicates within the same kind.
 */
export function createNonWageEmployee(deps: ServiceDeps, companyId: string, kind: NonWageKind, input: NonWageEmployeeInput, userId: string): EmployeeView {
  if (input.name === undefined) throw invalidField('name', 'This field is required.')
  const name = input.name
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const departmentId = input.department ?? null
    const positionId = input.position ?? null
    assertOrganization(deps, companyId, departmentId, positionId)
    const identity = input.registration_number === undefined || input.registration_number === '' ? {} : resolveIdentity(deps, companyId, kind, null, input, null, false)
    const values: EmployeeWrite = {
      name,
      english_name: input.english_name ?? null,
      registration_number_enc: identity.registration_number_enc ?? null,
      registration_number_hash: identity.registration_number_hash ?? null,
      identification_number_type: identity.identification_number_type ?? input.identification_number_type ?? 'registration',
      birth_date: identity.birth_date ?? input.birth_date ?? null,
      email: input.email === '' ? null : (input.email ?? null),
      phone: input.phone ?? null,
      is_local: toFlag(input.is_local ?? true),
      nationality: input.nationality ?? null,
      visa: input.visa ?? null,
      is_residence: toFlag(input.is_residence ?? true),
      country_of_residence: input.country_of_residence ?? '대한민국',
      employee_number: null,
      department_id: departmentId,
      position_id: positionId,
      join_date: input.join_date ?? null,
      work_code: null,
      is_rejoin: 0,
    }
    const id = insertEmployee(deps.db, companyId, kind, values, 'manual', userId, now)
    markOrganizationUsed(deps.db, companyId, departmentId, positionId)
    saveNonWageDetail(deps.db, companyId, id, detailColumns(deps, input), now)
    return requireNonWageView(deps, companyId, id)
  })
}

/** Applies a partial edit to a daily, business or other income earner; absent fields keep their values. */
export function patchNonWageEmployee(deps: ServiceDeps, employee: EmployeeRow, input: NonWageEmployeeInput): EmployeeView {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const values: Partial<EmployeeWrite> = commonColumns(input)
    if ('department' in input) {
      assertOrganization(deps, employee.company_id, input.department ?? null, null)
      values.department_id = input.department ?? null
    }
    if ('position' in input) {
      assertOrganization(deps, employee.company_id, null, input.position ?? null)
      values.position_id = input.position ?? null
    }
    if ('join_date' in input) values.join_date = input.join_date ?? null
    Object.assign(values, resolveIdentity(deps, employee.company_id, employee.kind, employee.id, input, employee, false))
    updateEmployee(deps.db, employee.company_id, employee.id, values, now)
    markOrganizationUsed(deps.db, employee.company_id, values.department_id ?? null, values.position_id ?? null)
    saveNonWageDetail(deps.db, employee.company_id, employee.id, detailColumns(deps, input), now)
    return requireNonWageView(deps, employee.company_id, employee.id)
  })
}

function detailColumns(deps: ServiceDeps, input: NonWageEmployeeInput): Partial<NonWageDetailWrite> {
  const values: Partial<NonWageDetailWrite> = {}
  if ('leave_date' in input) values.leave_date = input.leave_date ?? null
  if ('daily_wage' in input) values.daily_wage = input.daily_wage ?? null
  if ('business_code' in input) values.business_code = input.business_code ?? null
  if ('other_income_code' in input) values.other_income_code = input.other_income_code ?? null
  if ('bank_code' in input) values.bank_code = input.bank_code ?? null
  if ('account_holder' in input) values.account_holder = input.account_holder ?? null
  const account = input.account_number
  if (account !== undefined && (account === null || !account.includes('*'))) {
    const digits = account?.replace(/[\s-]/g, '') ?? ''
    if (digits !== '' && !/^\d{6,20}$/.test(digits)) throw invalidField('account_number', 'Enter the account number in digits.')
    values.account_number_enc = digits === '' ? null : deps.cipher.encrypt(digits)
  }
  return values
}

function requireNonWageView(deps: ServiceDeps, companyId: string, employeeId: number): EmployeeView {
  const view = findEmployeeView(deps.db, companyId, employeeId, deps.clock.today())
  if (view === undefined) throw notFound('Employee')
  return view
}
