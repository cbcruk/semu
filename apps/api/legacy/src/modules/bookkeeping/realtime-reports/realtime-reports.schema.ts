import { z } from 'zod'
import { plainDateParam } from '../bookkeeping.utils'

/** Query string of the realtime profit and loss. */
export const profitLossQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  cumulative: z.enum(['true', 'false']).optional(),
})

/** Query string of 매출·매입 현황. */
export const salesPurchaseQuery = z.object({
  unit: z.enum(['day', 'month', 'quarter', 'year']).default('month'),
  preset: z.string().optional(),
  start: plainDateParam.optional(),
  end: plainDateParam.optional(),
})

/** Query string of 일별 자금. */
export const cashDailyQuery = z.object({ date: plainDateParam.optional(), group_by: z.enum(['account', 'category']).default('account') })

/** Query string of 기간별 추이. */
export const cashPeriodQuery = z.object({ unit: z.enum(['month', 'quarter', 'year']).default('month'), preset: z.string().default('last_6_months') })
