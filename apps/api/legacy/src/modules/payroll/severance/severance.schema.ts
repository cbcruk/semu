import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'
import { INTERIM_REASONS } from './severance.types'

const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)
const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')
const id = z.number().int().positive()

/** Query of the settlement list and status counts. */
export const settlementListQuery = z.object({
  kind: z.enum(['retirement', 'interim']).optional(),
  status: z.enum(['in_progress', 'completed', 'excluded']).optional(),
  search: z.string().max(50).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Body of `POST settlements`: retirement or interim settlements for several employees. */
export const createSettlementBody = z
  .object({
    kind: z.enum(['retirement', 'interim']),
    employee_ids: z.array(id).min(1).max(200),
    reason: z.enum(INTERIM_REASONS as [string, ...string[]]).optional(),
    base_date: plainDate.optional(),
  })
  .refine((body) => body.kind === 'retirement' || body.reason !== undefined, { message: 'Interim settlements need a reason.', path: ['reason'] })

/** Body of `temp-save` and `complete`. */
export const settlementInputBody = z.object({
  annual_bonus: won.optional(),
  annual_leave_pay: won.optional(),
  ordinary_daily_wage: won.optional(),
  payment_date: plainDate.optional(),
  monthly_wages: z.array(z.object({ id, base_pay: won, allowances: won })).max(6).optional(),
})

/** Body of `exclude`. */
export const excludeBody = z.object({ reason: z.string().trim().min(1).max(500) })
