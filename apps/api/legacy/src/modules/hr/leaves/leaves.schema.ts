import { z } from 'zod'
import { nullableDate, nullableWon, plainDate } from '../shared/hr.schema'

/** Body of `POST`/`PUT leave-of-absences`. */
export const leaveBody = z.object({
  reason: z.enum(['maternity', 'parental', 'illness', 'etc']),
  start_date: plainDate,
  end_date: plainDate,
  expected_return_date: nullableDate,
  actual_return_date: nullableDate,
  is_paid: z.boolean().default(false),
  paid_allowance: nullableWon,
  include_in_service_years: z.boolean().default(false),
  nps_payment_exception: z.boolean().default(false),
  nhis_notice_deferral: z.boolean().default(false),
})
