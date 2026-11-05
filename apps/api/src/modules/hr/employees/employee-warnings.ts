import { addDays } from '../../../shared/time/calendar.ts'
import { currentWorkContract, isFollowedByLaterContract } from '../contracts/work-contract-period.ts'
import type { EmployeeWarningCode, EmployeeWarningInput } from './employee-warnings.types.ts'

/** 계약 만료 임박으로 보는 기간(일)입니다. 제품 값은 미확인입니다 (`docs/design/hr.md` 열린 질문 5). */
export const CONTRACT_EXPIRY_WARNING_DAYS = 30

/**
 * 직원 목록 ▲ 아이콘과 계약 만료 배너에 쓰는 경고입니다.
 *
 * - 근로소득자인데 주민등록번호가 없으면 `MISSING_REGISTRATION_NUMBER`
 * - 퇴직 전이고 현재 계약이 기간제일 때, 종료일이 지났고 뒤이은 계약이 없으면 `CONTRACT_EXPIRED`,
 *   종료일이 오늘부터 `warningDays`일 안이면 `CONTRACT_EXPIRING_SOON`
 * - 퇴직 전이고 무기계약 전환 대상이면 `INDEFINITE_CONVERSION_TARGET`
 */
export function employeeWarnings(
  input: EmployeeWarningInput,
  asOf: string,
  warningDays: number = CONTRACT_EXPIRY_WARNING_DAYS,
): EmployeeWarningCode[] {
  const warnings: EmployeeWarningCode[] = []
  if (input.kind === 'WAGE' && !input.hasRegistrationNumber) warnings.push('MISSING_REGISTRATION_NUMBER')
  const current = currentWorkContract(input.contracts, asOf)
  const end = current?.endDate
  if (input.status !== 'RESIGNED' && current?.contractType === 'FIXED_TERM' && end !== undefined) {
    if (end < asOf) {
      if (!isFollowedByLaterContract(current, input.contracts)) warnings.push('CONTRACT_EXPIRED')
    } else if (end <= addDays(asOf, warningDays)) {
      warnings.push('CONTRACT_EXPIRING_SOON')
    }
  }
  if (input.status !== 'RESIGNED' && input.isIndefiniteConversionTarget) warnings.push('INDEFINITE_CONVERSION_TARGET')
  return warnings
}
