import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'
import { isYearMonth } from '../engine/rate-table'
import { simpleRowSchema } from './cards.schema'

const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)
const yearMonth = z.string().refine(isYearMonth, 'Expected a YYYY-MM month.')
const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')
const id = z.number().int().positive()
const rawAmounts = z.record(z.string().regex(/^\d+$/, 'Keys are payment or deduction item IDs.'), z.number().int())

/** A legacy wage row in `POST cards/:c/data`; `taxable_incomes` and `other_deductions` stay keyed by item ID. */
export const legacyWageRowSchema = z.object({
  id,
  base_pay: won.optional(),
  prorate_requested: z.boolean().optional(),
  taxable_incomes: rawAmounts.optional(),
  other_deductions: rawAmounts.optional(),
  email: z.email().nullable().optional(),
})

/** Body of `POST cards/:c/data` (임시저장), grouped by legacy income key. */
export const legacyDataBody = z.object({
  wage_salary: z.array(legacyWageRowSchema).max(500).optional(),
  daily: z.array(simpleRowSchema).max(500).optional(),
  business: z.array(simpleRowSchema).max(500).optional(),
  other_labor: z.array(simpleRowSchema).max(500).optional(),
})

/** Body of `POST cards` (extension: the default card the monthly batch would create). */
export const legacyCreateBody = z.object({ attribution_month: yearMonth, payment_date: plainDate.optional(), name: z.string().trim().min(1).max(100).optional() })

/** Body of `PATCH cards/:c/update-name`. */
export const legacyNameBody = z.object({ name: z.string().trim().min(1).max(100) })

/** Query of `card-summary/group-by-attr-date`. */
export const groupByAttrDateQuery = z.object({
  fixed_cards_only: z.enum(['true', 'false']).optional(),
  attr_date: yearMonth.optional(),
  status: z.enum(['input_available', 'calculating', 'done']).optional(),
})

/** Query of `card-summary`. */
export const legacySummaryQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() })

/** Query of the `income_type` + `keyword` lookups. */
export const keywordQuery = z.object({ income_type: z.string().max(20).optional(), keyword: z.string().max(50).optional() })

/** Query of `cards/:c` and `cards/:c/fixed-payrolls`. */
export const legacyDetailQuery = z.object({ fixed_cards_only: z.enum(['true', 'false']).optional(), income_type: z.string().max(20).optional() })

/** Body of `POST cards/:c/payslip`: emails and payment formulas per wage row. */
export const legacyPayslipBody = z.object({
  wage_salary: z
    .array(z.object({ id, email: z.email().nullable().optional(), payment_formulas: z.record(z.string().max(50), z.string().max(500)).optional() }))
    .max(500),
})

/** Body of `POST payslip/wage-salary/notifications`. */
export const legacyNotificationBody = z.object({ row_ids: z.array(id).min(1).max(500) })
