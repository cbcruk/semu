/** A row of `employee_social_insurance_infos`. */
export interface SocialInsuranceRow {
  id: number
  company_id: string
  employee_id: number
  effective_from: string
  is_representative_or_executive: 0 | 1
  is_representative_relative: 0 | 1
  is_person_of_merit: 0 | 1
  is_non_regular: 0 | 1
  nps_enrolled: 0 | 1
  nhis_enrolled: 0 | 1
  ei_enrolled: 0 | 1
  iais_enrolled: 0 | 1
  nps_exclusion_reason: string | null
  nhis_exclusion_reason: string | null
  ei_exclusion_reason: string | null
  iais_exclusion_reason: string | null
  nps_pay_acquisition_month: 0 | 1
  durunuri_applied: 0 | 1
  updated_by: string | null
  updated_at: string
}

/** The editable social insurance settings, as booleans. */
export interface SocialInsuranceSettings {
  is_representative_or_executive: boolean
  is_representative_relative: boolean
  is_person_of_merit: boolean
  is_non_regular: boolean
  nps_enrolled: boolean
  nhis_enrolled: boolean
  ei_enrolled: boolean
  iais_enrolled: boolean
  nps_exclusion_reason: string | null
  nhis_exclusion_reason: string | null
  ei_exclusion_reason: string | null
  iais_exclusion_reason: string | null
  nps_pay_acquisition_month: boolean
  durunuri_applied: boolean
}

/** Code of an automatic determination the server applies. */
export type DeterminationCode = 'nps_over_60_new_hire' | 'nps_over_60_incumbent' | 'ei_over_65_new_hire'

/** Code of an informational message, in the client's mixed casing. */
export type InsuranceMessageCode =
  | 'nps_under_60h_enrolled'
  | 'EI_FOREIGNER_OPTIONAL'
  | 'EI_FOREIGNER_RECIPROCITY_AGREEMENT'
  | 'EI_FOREIGNER_RECIPROCITY_NON_AGREEMENT'

/** Facts about the employee that drive the determinations. */
export interface DeterminationFacts {
  birthDate: string | null
  joinDate: string | null
  isLocal: boolean
  visa: string | null
  nationality: string | null
  weeklyWorkHours: number | null
}

/** Determinations, messages and the enrolment the rules recommend. */
export interface DeterminationResult {
  determinations: { code: DeterminationCode }[]
  messages: { code: InsuranceMessageCode }[]
  recommended: Pick<
    SocialInsuranceSettings,
    'nps_enrolled' | 'nhis_enrolled' | 'ei_enrolled' | 'iais_enrolled' | 'nps_exclusion_reason' | 'nhis_exclusion_reason' | 'ei_exclusion_reason' | 'iais_exclusion_reason'
  >
}
