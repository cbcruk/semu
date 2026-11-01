import type { DatabaseSync } from 'node:sqlite'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findEffectiveRow, saveEffectiveRow } from '../shared/effective-dated.repository'
import { toFlag } from '../shared/hr.utils'
import type { SocialInsuranceRow, SocialInsuranceSettings } from './social-insurance.types'

/**
 * Finds the social insurance settings in force on a date.
 *
 * @returns The settings, or `undefined` when none were saved on or before the date (all four insurances then apply).
 */
export function findSocialInsuranceAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): SocialInsuranceRow | undefined {
  return findEffectiveRow<SocialInsuranceRow>(db, 'employee_social_insurance_infos', companyId, employeeId, date)
}

/** Saves social insurance settings effective from a date. */
export function saveSocialInsurance(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  effectiveFrom: PlainDate,
  settings: SocialInsuranceSettings,
  userId: string,
  now: string,
): void {
  saveEffectiveRow(
    db,
    'employee_social_insurance_infos',
    companyId,
    employeeId,
    effectiveFrom,
    {
      is_representative_or_executive: toFlag(settings.is_representative_or_executive),
      is_representative_relative: toFlag(settings.is_representative_relative),
      is_person_of_merit: toFlag(settings.is_person_of_merit),
      is_non_regular: toFlag(settings.is_non_regular),
      nps_enrolled: toFlag(settings.nps_enrolled),
      nhis_enrolled: toFlag(settings.nhis_enrolled),
      ei_enrolled: toFlag(settings.ei_enrolled),
      iais_enrolled: toFlag(settings.iais_enrolled),
      nps_exclusion_reason: settings.nps_exclusion_reason,
      nhis_exclusion_reason: settings.nhis_exclusion_reason,
      ei_exclusion_reason: settings.ei_exclusion_reason,
      iais_exclusion_reason: settings.iais_exclusion_reason,
      nps_pay_acquisition_month: toFlag(settings.nps_pay_acquisition_month),
      durunuri_applied: toFlag(settings.durunuri_applied),
    },
    userId,
    now,
  )
}
