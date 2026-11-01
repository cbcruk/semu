import type { Cipher } from '../../../lib/crypto/crypto.types'
import type { PlainDate } from '../../../lib/plain-date.types'
import { indefiniteConversionAlert } from '../contracts/contracts.utils'
import type { WorkContractRow } from '../contracts/contracts.types'
import { fromFlag, toEmploymentType } from '../shared/hr.utils'
import { maskIdentificationNumber } from '../shared/registration-number'
import { CONTRACT_EXPIRY_WARNING_DAYS } from './employees.repository'
import type { EmployeeView } from './employees.types'
import { employeeWarnings, STATUS_CODE, STATUS_LABEL } from './employees.utils'

/** Returns the masked registration or passport number of an employee row, or `null` when none is stored. */
export function maskedRegistrationNumber(view: Pick<EmployeeView, 'registration_number_enc' | 'identification_number_type'>, cipher: Cipher): string | null {
  return view.registration_number_enc === null ? null : maskIdentificationNumber(cipher.decrypt(view.registration_number_enc), view.identification_number_type)
}

/** Serialises the person-level fields shared by every employee kind (`common-info`). */
export function serializeCommonInfo(view: EmployeeView, cipher: Cipher): Record<string, unknown> {
  return {
    id: view.id,
    kind: view.kind,
    employment_type: toEmploymentType(view.kind),
    name: view.name,
    english_name: view.english_name,
    registration_number: maskedRegistrationNumber(view, cipher),
    identification_number_type: view.identification_number_type,
    birth_date: view.birth_date,
    email: view.email,
    phone: view.phone,
    is_local: fromFlag(view.is_local),
    nationality: view.nationality,
    visa: view.visa,
    is_residence: fromFlag(view.is_residence),
    country_of_residence: view.country_of_residence,
  }
}

/**
 * Serialises a wage employee for the list and detail views.
 *
 * @param fixedTermContracts The employee's fixed-term contracts, used for the two-year warning.
 */
export function serializeWageEmployee(
  view: EmployeeView,
  cipher: Cipher,
  today: PlainDate,
  fixedTermContracts: readonly WorkContractRow[],
): Record<string, unknown> {
  const alert = indefiniteConversionAlert(fixedTermContracts, view.birth_date, today)
  const warnings = employeeWarnings(view, today, alert.is_target, CONTRACT_EXPIRY_WARNING_DAYS)
  return {
    ...serializeCommonInfo(view, cipher),
    status: view.status,
    status_code: STATUS_CODE[view.status],
    status_display: STATUS_LABEL[view.status],
    employee_number: view.employee_number,
    department: view.department_id,
    department_name: view.department_name,
    position: view.position_id,
    position_name: view.position_name,
    join_date: view.join_date,
    leave_date: view.leave_date,
    work_code: view.work_code,
    contract_type: view.contract_type ?? 'none',
    contract_end_date: view.contract_end_date,
    has_warning: warnings.length > 0,
    warnings,
    is_rejoin: fromFlag(view.is_rejoin),
    source: view.source,
    version: view.version,
    created: view.created_at,
    updated: view.updated_at,
  }
}
