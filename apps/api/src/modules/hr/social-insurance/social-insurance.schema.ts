import { z } from 'zod'
import { nullableDate, nullableText } from '../shared/hr.schema'

const settingsShape = {
  is_representative_or_executive: z.boolean().default(false),
  is_representative_relative: z.boolean().default(false),
  is_person_of_merit: z.boolean().default(false),
  is_non_regular: z.boolean().default(false),
  nps_enrolled: z.boolean().default(true),
  nhis_enrolled: z.boolean().default(true),
  ei_enrolled: z.boolean().default(true),
  iais_enrolled: z.boolean().default(true),
  nps_exclusion_reason: nullableText(100),
  nhis_exclusion_reason: nullableText(100),
  ei_exclusion_reason: nullableText(100),
  iais_exclusion_reason: nullableText(100),
  nps_pay_acquisition_month: z.boolean().default(false),
  durunuri_applied: z.boolean().default(false),
}

/** Body of `PUT social-insurance-info`; `effective_date` defaults to today (신규 설계). */
export const socialInsuranceBody = z.object({ ...settingsShape, effective_date: nullableDate })

/** Body of `POST social-insurance-info/preview`: unsaved settings plus optional fact overrides from the open form. */
export const socialInsurancePreviewBody = z.object({
  ...settingsShape,
  birth_date: nullableDate,
  join_date: nullableDate,
  weekly_work_hours: z.number().min(0).max(168).nullable().optional(),
  is_local: z.boolean().optional(),
  visa: nullableText(20),
  nationality: nullableText(50),
})
