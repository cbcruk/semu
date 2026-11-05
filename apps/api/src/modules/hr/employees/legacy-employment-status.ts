import type { EmployeeStatus } from './employee-status.types.ts'
import type { InsuranceFilingKind } from '../insurance-filings/insurance-filing.types.ts'

/** 레거시 직원 관리의 한글 재직 상태입니다. 재설계 API에는 나오지 않고 이관 매핑에만 씁니다. */
export type LegacyEmploymentStatus = '재직' | '휴직' | '퇴사' | '임시저장' | '입사처리중' | '퇴사처리중' | '휴직처리중'

/**
 * 재설계 상태와 열린 4대보험 신고로 레거시 `employment_status`를 다시 만듭니다.
 *
 * 주민등록번호가 없으면 `임시저장`, 열린 신고가 있으면 상실 > 휴직 > 취득 순으로 `○○처리중`,
 * 나머지는 재직·휴직·퇴사입니다. 입사예정은 레거시에 없어 `재직`입니다.
 */
export function legacyEmploymentStatus(
  input: { hasRegistrationNumber: boolean; status: EmployeeStatus },
  pendingFilings: ReadonlySet<InsuranceFilingKind>,
): LegacyEmploymentStatus {
  if (!input.hasRegistrationNumber) return '임시저장'
  if (pendingFilings.has('LOSS')) return '퇴사처리중'
  if (pendingFilings.has('LEAVE')) return '휴직처리중'
  if (pendingFilings.has('ACQUISITION')) return '입사처리중'
  if (input.status === 'LEAVE') return '휴직'
  if (input.status === 'RESIGNED') return '퇴사'
  return '재직'
}

/**
 * 레거시 한글 상태를 이관할 때 무엇으로 바꾸는지입니다. 상태 자체는 날짜로 다시 계산하므로,
 * 저장할 것은 주민등록번호 누락 여부와 열어 둘 신고 종류뿐입니다.
 */
export function migrateLegacyEmploymentStatus(status: LegacyEmploymentStatus): {
  missingRegistrationNumber: boolean
  openFiling?: InsuranceFilingKind
} {
  switch (status) {
    case '임시저장':
      return { missingRegistrationNumber: true }
    case '입사처리중':
      return { missingRegistrationNumber: false, openFiling: 'ACQUISITION' }
    case '휴직처리중':
      return { missingRegistrationNumber: false, openFiling: 'LEAVE' }
    case '퇴사처리중':
      return { missingRegistrationNumber: false, openFiling: 'LOSS' }
    default:
      return { missingRegistrationNumber: false }
  }
}
