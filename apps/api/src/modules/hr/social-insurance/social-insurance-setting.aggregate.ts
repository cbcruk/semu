import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { upsertEntry } from '../tax-withholding/tax-withholding-history.ts'
import { enrollmentViolations } from './social-insurance-setting-rules.ts'
import {
  SocialInsuranceSettingInvalid,
  type SocialInsuranceSettingInput,
  type SocialInsuranceSettingRecord,
} from './social-insurance-setting.ts'

/**
 * 4대보험 설정 애그리거트입니다(docs/design/domain-model.md). 직원 한 명의 유효일 이력이고 버전은 이력 전체에 하나입니다.
 *
 * 근로소득자만 가질 수 있다는 검사와 버전 검사(`If-Match`)는 서비스가 판정 전에 합니다. 오류 순서(소득 구분 → 버전 → 입력)를
 * 지키려는 것입니다. 보수 변경 신고를 맞추는 일은 domain-model.md 4단계(M6)에서 정책으로 다룹니다. 이벤트는 없습니다.
 */

/** 판정 결과입니다. */
export interface SocialInsuranceSettingDecision {
  setting: SocialInsuranceSettingRecord
}

/** 저장할 직원입니다. 설정 ID는 직원 ID입니다. */
export interface SettingOwner {
  companyId: Id<'company'>
  employeeId: Id<'employee'>
}

/**
 * 설정 저장을 판정합니다. 가입 여부 입력 규칙({@link enrollmentViolations})을 어기면 거부하고, 아니면 같은 `effectiveFrom`의
 * 항목을 바꾸거나 넣어 버전을 올립니다.
 */
export function decideSocialInsuranceSettingSave(
  owner: SettingOwner,
  current: SocialInsuranceSettingRecord | undefined,
  input: SocialInsuranceSettingInput,
  at: string,
): Result.Result<SocialInsuranceSettingDecision, SocialInsuranceSettingInvalid> {
  const violations = enrollmentViolations(input)
  if (violations.length > 0) return Result.fail(new SocialInsuranceSettingInvalid({ violations }))
  return Result.succeed({
    setting: {
      id: owner.employeeId,
      companyId: owner.companyId,
      entries: upsertEntry(current?.entries ?? [], input),
      version: (current?.version ?? 0) + 1,
      updatedAt: at,
    },
  })
}
