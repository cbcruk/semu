import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { advanceEmployeeVersion as bump } from '../employees/employees.service'
import type { EmployeeRow } from '../employees/employees.types'
import { HrError } from '../shared/hr-error'
import { toFlag } from '../shared/hr.utils'
import { enqueueInsuranceFiling, withdrawInsuranceFilings } from '../shared/insurance-filings.repository'
import { ifMatchRequired } from '../shared/optional-if-match'
import { isValidLeavingReason } from './leaving-reasons'
import { clearLeaving, findRetirementInfo, upsertRetirementInfo } from './retirement.repository'
import type { RetirementInfoRow, RetirementInput } from './retirement.types'

/**
 * Saves retirement benefit settings and, with a `leave_date`, registers or edits the retirement (퇴직 등록).
 *
 * Benefit settings alone are plain edits. Changing the leave date changes
 * the employee's status, so it needs the employee version; the chosen
 * reasons go into the 상실 report unchanged (rule R17).
 *
 * @param expectedVersion The employee version from `If-Match`, or `null` when the header was absent.
 * @throws {HrError} `LEAVE_DATE_BEFORE_INTERIM` when the leave date precedes the interim settlement date (rule R18).
 */
export function saveRetirementInfo(
  deps: ServiceDeps,
  employee: EmployeeRow,
  input: RetirementInput,
  expectedVersion: number | null,
): { info: RetirementInfoRow; version: number } {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const current = findRetirementInfo(deps.db, employee.company_id, employee.id)
    validate(employee, input)
    const leaveChanged = (current?.leave_date ?? null) !== input.leave_date
    let version = employee.version
    if (leaveChanged) {
      if (expectedVersion === null) throw ifMatchRequired('employee')
      bump(deps, employee, expectedVersion, now)
      version = expectedVersion + 1
    }
    upsertRetirementInfo(
      deps.db,
      employee.company_id,
      employee.id,
      {
        retirement_benefit_type: input.retirement_benefit_type,
        has_interim_settlement: toFlag(input.has_interim_settlement),
        interim_settlement_date: input.has_interim_settlement ? input.interim_settlement_date : null,
        interim_settlement_reason: input.has_interim_settlement ? input.interim_settlement_reason : null,
        leave_date: input.leave_date,
        leaving_reason: input.leaving_reason,
        leaving_detail_reason: input.leaving_detail_reason,
        severance_amount: input.severance_amount,
      },
      now,
    )
    if (leaveChanged && input.leave_date !== null) {
      enqueueInsuranceFiling(deps.db, {
        companyId: employee.company_id,
        employeeId: employee.id,
        kind: 'leave',
        sourceType: 'retirement',
        sourceId: employee.id,
        payload: { leave_date: input.leave_date, leaving_reason: input.leaving_reason, leaving_detail_reason: input.leaving_detail_reason },
        now,
      })
    }
    if (leaveChanged && input.leave_date === null) withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'leave', 'retirement', employee.id, now)
    const info = findRetirementInfo(deps.db, employee.company_id, employee.id)
    if (info === undefined) throw notFound('Retirement info')
    return { info, version }
  })
}

/**
 * Cancels a registered retirement (퇴직 취소), returning the employee to employment.
 *
 * @throws {HrError} `RETIREMENT_COMPLETED` when the severance settlement is completed.
 */
export function cancelRetirement(deps: ServiceDeps, employee: EmployeeRow, expectedVersion: number): number {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const current = findRetirementInfo(deps.db, employee.company_id, employee.id)
    if (current?.severance_settlement_status === 'completed') {
      throw new HrError('RETIREMENT_COMPLETED', 'The severance settlement is completed, so the retirement cannot be cancelled.')
    }
    bump(deps, employee, expectedVersion, now)
    clearLeaving(deps.db, employee.company_id, employee.id, now)
    withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'leave', 'retirement', employee.id, now)
    return expectedVersion + 1
  })
}

function validate(employee: EmployeeRow, input: RetirementInput): void {
  if (input.has_interim_settlement) {
    if (input.interim_settlement_date === null) throw invalidField('interim_settlement_date', 'Enter the interim settlement date.')
    if (input.interim_settlement_reason === null) throw invalidField('interim_settlement_reason', 'Choose the interim settlement reason.')
    if (input.leave_date !== null && input.leave_date < input.interim_settlement_date) {
      throw new HrError('LEAVE_DATE_BEFORE_INTERIM', 'The leave date cannot be before the interim settlement date.')
    }
  }
  if (input.leave_date !== null) {
    if (employee.join_date !== null && input.leave_date < employee.join_date) throw invalidField('leave_date', 'The leave date cannot be before the join date.')
    if (input.leaving_reason === null) throw invalidField('leaving_reason', 'Choose the leaving reason.')
  }
  if (input.leaving_reason !== null && !isValidLeavingReason(input.leaving_reason, input.leaving_detail_reason)) {
    throw invalidField('leaving_reason', 'Unknown leaving reason or detail reason.')
  }
}
