import type { DatabaseSync } from 'node:sqlite'
import type { Clock } from '../../../lib/clock.types'
import { listWorkContracts } from '../../hr/contracts/contracts.repository'
import { listEmployees } from '../../hr/employees/employees.repository'
import type { SettingsUsageCounter } from './settings.types'

/**
 * Counts how many HR work contracts reference a work condition or work schedule policy.
 *
 * Settings use it to refuse deleting a condition or policy that is in use.
 */
export function createHrUsageCounter(db: DatabaseSync, clock: Clock): SettingsUsageCounter {
  const contractsOf = (companyId: string): ReturnType<typeof listWorkContracts> =>
    listEmployees(db, companyId, clock.today()).flatMap((employee) => listWorkContracts(db, companyId, employee.id))
  return {
    workConditionUsages: (companyId, workConditionId) => contractsOf(companyId).filter((contract) => contract.work_condition_id === workConditionId).length,
    workSchedulePolicyUsages: (companyId, policyId) => contractsOf(companyId).filter((contract) => contract.work_schedule_policy_id === policyId).length,
  }
}
