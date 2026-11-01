import { z } from 'zod'
import { nullableDate, nullableText, nullableWon } from '../shared/hr.schema'

/** Reasons for an interim severance settlement (근로자퇴직급여 보장법 시행령 제3조). */
export const INTERIM_SETTLEMENT_REASONS = [
  'home_purchase',
  'rent_deposit',
  'medical_treatment',
  'bankruptcy',
  'personal_rehabilitation',
  'wage_peak',
  'work_hours_reduction',
  'legal_work_hours_reduction',
  'etc_gov_notice',
] as const

/** Body of `PUT retirement-info`; a `leave_date` registers the retirement. */
export const retirementBody = z.object({
  retirement_benefit_type: z.enum(['grant', 'pension_db', 'pension_dc']).default('grant'),
  has_interim_settlement: z.boolean().default(false),
  interim_settlement_date: nullableDate,
  interim_settlement_reason: z.enum(INTERIM_SETTLEMENT_REASONS).nullable().optional().transform((value) => value ?? null),
  leave_date: nullableDate,
  leaving_reason: nullableText(10),
  leaving_detail_reason: nullableText(10),
  severance_amount: nullableWon,
})
