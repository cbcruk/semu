import type { ContractPeriod } from '../contracts/work-contract-period.types.ts'
import type { EmployeeKind } from './employee-kind.types.ts'
import type { EmployeeStatus } from './employee-status.types.ts'

/** 직원 목록·상세의 경고 코드입니다. */
export type EmployeeWarningCode =
  'MISSING_REGISTRATION_NUMBER' | 'CONTRACT_EXPIRING_SOON' | 'CONTRACT_EXPIRED' | 'INDEFINITE_CONVERSION_TARGET'

/** 경고 계산 입력입니다. */
export interface EmployeeWarningInput {
  kind: EmployeeKind
  hasRegistrationNumber: boolean
  status: EmployeeStatus
  contracts: ReadonlyArray<ContractPeriod>
  isIndefiniteConversionTarget: boolean
}
