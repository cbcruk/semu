import { ageOn } from '../../../shared/time/calendar.ts'
import type {
  EligibilityFacts,
  EligibilityResult,
  Insurance,
  InsuranceEnrollment,
  InsuranceExclusionReason,
} from './insurance-eligibility.types.ts'

/** 내국인처럼 고용보험 당연가입인 체류자격입니다(영주·결혼이민·거주, 비전문취업·방문취업). */
export const EI_MANDATORY_VISAS: ReadonlyArray<string> = ['F-2', 'F-5', 'F-6', 'E-9', 'H-2']

/**
 * 본국법의 상호주의에 따라 고용보험 적용이 갈리는 체류자격입니다(주재·기업투자·무역경영).
 *
 * 고용보험법 시행령 제3조의3 제1호 가목: 법 전부를 적용하되, 고용보험에 상응하는 보험료와 급여에 관한 본국법이
 * 대한민국 국민에게 적용되지 않으면 제외합니다. 국가 목록은 법령이 정하지 않으므로 서버는 가입을 권하고 본국법 확인을 안내합니다.
 * 그 밖의 취업 체류자격(E-1~E-7 등)과 재외동포(F-4)는 신청해야 적용되는 임의가입이라(같은 조 제2호) 신청 전 기본값은
 * 미적용입니다. 목록에 없는 그 밖의 체류자격도 같은 조가 적용하지 않으므로 미적용으로 권합니다.
 */
export const EI_RECIPROCITY_VISAS: ReadonlyArray<string> = ['D-7', 'D-8', 'D-9']

const WEEKS_PER_MONTH = 365 / 7 / 12

/** 아무것도 저장하지 않았을 때의 설정입니다. 4대보험 모두 가입입니다. */
export const DEFAULT_ENROLLMENT: Readonly<Record<Insurance, InsuranceEnrollment>> = {
  nps: { enrolled: true },
  nhis: { enrolled: true },
  ei: { enrolled: true },
  iais: { enrolled: true },
}

/**
 * 직원 사실과 현재 가입 설정에 4대보험 자동 판정을 적용합니다(현행 R12–R13).
 *
 * - 국민연금: 입사 시 만 60세 이상이면 `NPS_OVER_60_NEW_HIRE`, 재직 중 60세가 되면 `NPS_OVER_60_INCUMBENT`로 제외.
 *   주 15시간 이상이지만 월 60시간 미만이면 제외하고, 가입 상태였으면 `NPS_UNDER_60_HOURS_ENROLLED`를 안내
 * - 고용보험: 만 65세 이후 입사면 `EI_OVER_65_NEW_HIRE`로 제외. 대표자·임원·동거 친족 제외
 * - 산재보험: 대표자·임원·동거 친족만 제외
 * - 주 15시간 미만이면 국민연금·건강·고용보험 제외
 * - 외국인 고용보험: 주재·기업투자·무역경영은 가입을 권하고 본국 상호주의 확인을 안내, 당연가입 체류자격이 아니면
 *   `EXEMPT_FOREIGNER`로 제외하고 신청하면 가입할 수 있다고 안내(`EI_FOREIGNER_OPTIONAL`)
 *
 * 순서가 결과에 영향을 줍니다. 뒤 규칙이 앞 규칙의 제외 사유를 덮어씁니다(현행과 같음).
 *
 * @example 만 61세 신규 입사자
 * ```ts
 * determineEligibility({ birthDate: '1965-01-01', joinDate: '2026-10-01', isForeigner: false, ... }, DEFAULT_ENROLLMENT, '2026-11-01')
 * // determinations: ['NPS_OVER_60_NEW_HIRE'], recommended.nps: { enrolled: false, exclusionReason: 'AGE_60_OR_OVER' }
 * ```
 */
export function determineEligibility(
  facts: EligibilityFacts,
  current: Readonly<Record<Insurance, InsuranceEnrollment>>,
  asOf: string,
): EligibilityResult {
  const result: EligibilityResult = {
    determinations: [],
    messages: [],
    recommended: {
      nps: { ...current.nps },
      nhis: { ...current.nhis },
      ei: { ...current.ei },
      iais: { ...current.iais },
    },
  }
  const exclude = (insurance: Insurance, reason: InsuranceExclusionReason): void => {
    result.recommended[insurance] = { enrolled: false, exclusionReason: reason }
  }
  if (facts.birthDate !== undefined) {
    const ageAtJoin = facts.joinDate === undefined ? undefined : ageOn(facts.birthDate, facts.joinDate)
    if (ageAtJoin !== undefined && ageAtJoin >= 60) {
      result.determinations.push('NPS_OVER_60_NEW_HIRE')
      exclude('nps', 'AGE_60_OR_OVER')
    } else if (ageOn(facts.birthDate, asOf) >= 60) {
      result.determinations.push('NPS_OVER_60_INCUMBENT')
      exclude('nps', 'AGE_60_OR_OVER')
    }
    if (ageAtJoin !== undefined && ageAtJoin >= 65) {
      result.determinations.push('EI_OVER_65_NEW_HIRE')
      exclude('ei', 'HIRED_AT_65_OR_OVER')
    }
  }
  if (facts.isRepresentativeOrExecutive) {
    exclude('ei', 'REPRESENTATIVE_OR_EXECUTIVE')
    exclude('iais', 'REPRESENTATIVE_OR_EXECUTIVE')
  } else if (facts.isRepresentativeRelative) {
    exclude('ei', 'REPRESENTATIVE_RELATIVE')
    exclude('iais', 'REPRESENTATIVE_RELATIVE')
  }
  if (facts.weeklyWorkHours !== undefined) {
    if (facts.weeklyWorkHours < 15) {
      exclude('nps', 'SHORT_PART_TIME')
      exclude('nhis', 'SHORT_PART_TIME')
      exclude('ei', 'SHORT_PART_TIME')
    } else if (facts.weeklyWorkHours * WEEKS_PER_MONTH < 60) {
      if (current.nps.enrolled) result.messages.push('NPS_UNDER_60_HOURS_ENROLLED')
      exclude('nps', 'PART_TIME_UNDER_60_HOURS')
    }
  }
  if (facts.isForeigner) {
    const visa = (facts.visaCode ?? '').toUpperCase()
    if (EI_RECIPROCITY_VISAS.includes(visa)) {
      result.messages.push('EI_FOREIGNER_RECIPROCITY_CHECK')
    } else if (!EI_MANDATORY_VISAS.includes(visa)) {
      result.messages.push('EI_FOREIGNER_OPTIONAL')
      exclude('ei', 'EXEMPT_FOREIGNER')
    }
  }
  return result
}
