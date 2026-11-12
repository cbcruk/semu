import type { EmployeeRecord } from '../employees/employee.ts'
import { DEFAULT_ENROLLMENT, determineEligibility } from './insurance-eligibility.ts'
import type { EligibilityResult } from './insurance-eligibility.types.ts'
import type { SocialInsuranceSettingEntry } from './social-insurance-setting.ts'

/**
 * 기준일에 실제로 적용하는 4대보험 가입 여부입니다. 그날 적용되는 설정(`entry`)이 있으면 그 가입 여부와 근로 조건을,
 * 없으면 모두 가입·대표자 아님을 출발점으로 자동 판정(재직 중 만 60세, 초단시간 등)을 덮어 적용합니다. 판정은 가입을 빼기만
 * 하므로 사용자가 정한 제외는 남습니다. 주 소정근로시간은 설정에 없으면 그날의 근로계약 값(`contractWeeklyHours`)입니다.
 *
 * 급여(`HrDirectory.socialInsuranceOf`)와 보수 변경 신고가 함께 씁니다. 본문 없는 `:determine`과 같은 값입니다.
 */
export function appliedEnrollment(
  employee: Pick<EmployeeRecord, 'birthDate' | 'joinDate' | 'isForeigner' | 'visaCode' | 'nationalityCode'>,
  entry: SocialInsuranceSettingEntry | undefined,
  contractWeeklyHours: number | undefined,
  asOf: string,
): EligibilityResult {
  return determineEligibility(
    {
      birthDate: employee.birthDate,
      joinDate: employee.joinDate,
      isForeigner: employee.isForeigner,
      visaCode: employee.visaCode,
      nationalityCode: employee.nationalityCode,
      weeklyWorkHours: entry?.weeklyWorkHours ?? contractWeeklyHours,
      isRepresentativeOrExecutive: entry?.isRepresentativeOrExecutive ?? false,
      isRepresentativeRelative: entry?.isRepresentativeRelative ?? false,
    },
    entry ?? DEFAULT_ENROLLMENT,
    asOf,
  )
}
