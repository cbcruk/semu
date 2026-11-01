import type { PlainDate } from '../../../lib/plain-date.types'
import { ageOn } from '../employees/employees.utils'
import type { DeterminationFacts, DeterminationResult, SocialInsuranceRow, SocialInsuranceSettings } from './social-insurance.types'

/** Visas whose holders are covered by 고용보험 like nationals (영주·결혼이민·거주, 비전문취업·방문취업). */
export const EI_MANDATORY_VISAS: readonly string[] = ['F-2', 'F-5', 'F-6', 'E-9', 'H-2']

/** Visas whose coverage depends on reciprocity with the holder's country. */
export const EI_RECIPROCITY_VISAS: readonly string[] = ['D-7', 'D-8', 'D-9', 'E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7']

/**
 * Nationalities (ISO 3166-1 alpha-2) with a 고용보험 reciprocity arrangement.
 *
 * Left empty until the list is confirmed against the 고용노동부 notice; until then every reciprocity visa is treated as non-agreement.
 */
export const EI_RECIPROCITY_COUNTRIES: readonly string[] = []

const WEEKS_PER_MONTH = 365 / 7 / 12

/** Settings applied when nothing has been saved: all four insurances enrolled. */
export const DEFAULT_SOCIAL_INSURANCE: SocialInsuranceSettings = {
  is_representative_or_executive: false,
  is_representative_relative: false,
  is_person_of_merit: false,
  is_non_regular: false,
  nps_enrolled: true,
  nhis_enrolled: true,
  ei_enrolled: true,
  iais_enrolled: true,
  nps_exclusion_reason: null,
  nhis_exclusion_reason: null,
  ei_exclusion_reason: null,
  iais_exclusion_reason: null,
  nps_pay_acquisition_month: false,
  durunuri_applied: false,
}

/** Converts a stored row to boolean settings. */
export function toSettings(row: SocialInsuranceRow | undefined): SocialInsuranceSettings {
  if (row === undefined) return { ...DEFAULT_SOCIAL_INSURANCE }
  return {
    is_representative_or_executive: row.is_representative_or_executive === 1,
    is_representative_relative: row.is_representative_relative === 1,
    is_person_of_merit: row.is_person_of_merit === 1,
    is_non_regular: row.is_non_regular === 1,
    nps_enrolled: row.nps_enrolled === 1,
    nhis_enrolled: row.nhis_enrolled === 1,
    ei_enrolled: row.ei_enrolled === 1,
    iais_enrolled: row.iais_enrolled === 1,
    nps_exclusion_reason: row.nps_exclusion_reason,
    nhis_exclusion_reason: row.nhis_exclusion_reason,
    ei_exclusion_reason: row.ei_exclusion_reason,
    iais_exclusion_reason: row.iais_exclusion_reason,
    nps_pay_acquisition_month: row.nps_pay_acquisition_month === 1,
    durunuri_applied: row.durunuri_applied === 1,
  }
}

/**
 * Applies the automatic 4대보험 rules to an employee's facts and settings (rules R12–R13).
 *
 * - 국민연금: excluded from age 60 (`nps_over_60_new_hire` when hired at 60 or later, otherwise `nps_over_60_incumbent`), and below 60 hours a month.
 * - 고용보험: excluded when hired at 65 or later (`ei_over_65_new_hire`), for representatives, executives and their cohabiting relatives, and below 15 hours a week.
 * - 산재보험: excluded only for representatives, executives and their cohabiting relatives.
 * - Foreign employees get an 고용보험 message by visa: mandatory, optional (임의가입) or reciprocity-based.
 *
 * @example A 61-year-old new hire
 * ```ts
 * import { determineSocialInsurance, DEFAULT_SOCIAL_INSURANCE } from './social-insurance.utils'
 *
 * const result = determineSocialInsurance(
 *   { birthDate: '1965-01-01', joinDate: '2026-10-01', isLocal: true, visa: null, nationality: null, weeklyWorkHours: 40 },
 *   DEFAULT_SOCIAL_INSURANCE,
 *   '2026-11-01',
 * )
 * result.determinations // [{ code: 'nps_over_60_new_hire' }]
 * result.recommended.nps_enrolled // false
 * ```
 */
export function determineSocialInsurance(facts: DeterminationFacts, settings: SocialInsuranceSettings, today: PlainDate): DeterminationResult {
  const result: DeterminationResult = {
    determinations: [],
    messages: [],
    recommended: {
      nps_enrolled: settings.nps_enrolled,
      nhis_enrolled: settings.nhis_enrolled,
      ei_enrolled: settings.ei_enrolled,
      iais_enrolled: settings.iais_enrolled,
      nps_exclusion_reason: settings.nps_exclusion_reason,
      nhis_exclusion_reason: settings.nhis_exclusion_reason,
      ei_exclusion_reason: settings.ei_exclusion_reason,
      iais_exclusion_reason: settings.iais_exclusion_reason,
    },
  }
  const exclude = (insurance: 'nps' | 'nhis' | 'ei' | 'iais', reason: string): void => {
    result.recommended[`${insurance}_enrolled`] = false
    result.recommended[`${insurance}_exclusion_reason`] = reason
  }
  if (facts.birthDate !== null) {
    const ageAtJoin = facts.joinDate === null ? null : ageOn(facts.birthDate, facts.joinDate)
    const ageToday = ageOn(facts.birthDate, today)
    if (ageAtJoin !== null && ageAtJoin >= 60) {
      result.determinations.push({ code: 'nps_over_60_new_hire' })
      exclude('nps', '만 60세 이상')
    } else if (ageToday >= 60) {
      result.determinations.push({ code: 'nps_over_60_incumbent' })
      exclude('nps', '만 60세 이상')
    }
    if (ageAtJoin !== null && ageAtJoin >= 65) {
      result.determinations.push({ code: 'ei_over_65_new_hire' })
      exclude('ei', '만 65세 이후 고용된 자')
    }
  }
  if (settings.is_representative_or_executive) {
    exclude('ei', '대표자, 사내이사')
    exclude('iais', '대표자, 사내이사')
  } else if (settings.is_representative_relative) {
    exclude('ei', '대표자와 동거하는 친족')
    exclude('iais', '대표자와 동거하는 친족')
  }
  if (facts.weeklyWorkHours !== null) {
    if (facts.weeklyWorkHours < 15) {
      exclude('nps', '초단시간 근로자(주 15h 미만)')
      exclude('nhis', '초단시간 근로자(주 15h 미만)')
      exclude('ei', '초단시간 근로자(주 15h 미만)')
    } else if (facts.weeklyWorkHours * WEEKS_PER_MONTH < 60) {
      if (settings.nps_enrolled) result.messages.push({ code: 'nps_under_60h_enrolled' })
      exclude('nps', '단시간 근로자(월 60h 미만)')
    }
  }
  if (!facts.isLocal) {
    const visa = (facts.visa ?? '').toUpperCase()
    if (EI_RECIPROCITY_VISAS.includes(visa)) {
      const agreed = facts.nationality !== null && EI_RECIPROCITY_COUNTRIES.includes(facts.nationality.toUpperCase())
      result.messages.push({ code: agreed ? 'EI_FOREIGNER_RECIPROCITY_AGREEMENT' : 'EI_FOREIGNER_RECIPROCITY_NON_AGREEMENT' })
      if (!agreed) exclude('ei', '면제 대상의 외국인')
    } else if (!EI_MANDATORY_VISAS.includes(visa)) {
      result.messages.push({ code: 'EI_FOREIGNER_OPTIONAL' })
    }
  }
  return result
}
