/** 4대보험 종류입니다. 국민연금·건강보험·고용보험·산재보험입니다. */
export type Insurance = 'nps' | 'nhis' | 'ei' | 'iais'

/** 서버가 자동으로 적용하는 판정 코드입니다. 현행 소문자 코드를 대문자로 맞췄습니다. */
export type EligibilityDeterminationCode = 'NPS_OVER_60_NEW_HIRE' | 'NPS_OVER_60_INCUMBENT' | 'EI_OVER_65_NEW_HIRE'

/** 안내 메시지 코드입니다. */
export type EligibilityMessageCode =
  'NPS_UNDER_60_HOURS_ENROLLED' | 'EI_FOREIGNER_OPTIONAL' | 'EI_FOREIGNER_RECIPROCITY_CHECK'

/** 가입 제외 사유 코드입니다. 표시 문자열은 참조 데이터가 줍니다. */
export type InsuranceExclusionReason =
  | 'AGE_60_OR_OVER'
  | 'HIRED_AT_65_OR_OVER'
  | 'REPRESENTATIVE_OR_EXECUTIVE'
  | 'REPRESENTATIVE_RELATIVE'
  | 'SHORT_PART_TIME'
  | 'PART_TIME_UNDER_60_HOURS'
  | 'EXEMPT_FOREIGNER'
  | 'OTHER'

/** 보험 하나의 가입 여부와 제외 사유입니다. */
export interface InsuranceEnrollment {
  enrolled: boolean
  exclusionReason?: InsuranceExclusionReason | undefined
}

/** 판정에 쓰는 직원 사실입니다. */
export interface EligibilityFacts {
  birthDate?: string | undefined
  joinDate?: string | undefined
  isForeigner: boolean
  visaCode?: string | undefined
  nationalityCode?: string | undefined
  weeklyWorkHours?: number | undefined
  isRepresentativeOrExecutive: boolean
  isRepresentativeRelative: boolean
}

/** 판정 결과입니다. `recommended`는 현재 설정에 판정을 적용한 권장 가입 여부입니다. */
export interface EligibilityResult {
  determinations: EligibilityDeterminationCode[]
  messages: EligibilityMessageCode[]
  recommended: Record<Insurance, InsuranceEnrollment>
}
