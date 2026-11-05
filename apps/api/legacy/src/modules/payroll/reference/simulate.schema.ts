import { z } from 'zod'

const won = z.number().int().min(0).max(10_000_000_000)
const targetDate = z.string().regex(/^(?!0000)\d{4}(0[1-9]|1[0-2])$/, 'Expected YYYYMM.').optional()

/** Body of `POST /api/payroll/calculator/simulate`, one shape per calculator tab (추정). */
export const simulateBody = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wage'),
    target_date: targetDate,
    monthly_pay: won,
    non_taxable_pay: won.optional(),
    meal_allowance: won.optional(),
    dependants: z.number().int().min(1).max(20).optional(),
    children_aged_8_to_20: z.number().int().min(0).max(20).optional(),
    withholding_ratio: z.union([z.literal(80), z.literal(100), z.literal(120)]).optional(),
  }),
  z.object({
    type: z.literal('daily'),
    target_date: targetDate,
    daily_pay: won,
    work_days: z.number().int().min(1).max(31).optional(),
  }),
  z.object({
    type: z.literal('business'),
    target_date: targetDate,
    pay_amount: won,
    tax_deduction_mode: z.enum(['before_tax', 'after_tax']).optional(),
  }),
  z.object({
    type: z.literal('other'),
    target_date: targetDate,
    pay_amount: won,
    income_type_code: z.string().max(10).optional(),
    necessary_expense_rate: z.number().int().min(0).max(100).optional(),
    tax_deduction_mode: z.enum(['before_tax', 'after_tax']).optional(),
  }),
])

/** Query of `GET /api/tax-rates/simple`: one lookup when `monthly_pay` is given, otherwise the generated table. */
export const simpleTaxQuery = z.object({
  target_date: targetDate,
  monthly_pay: z.coerce.number().int().min(0).max(10_000_000_000).optional(),
  dependants: z.coerce.number().int().min(1).max(20).optional(),
  children: z.coerce.number().int().min(0).max(20).optional(),
})

/** Query of reference lists filtered by month. */
export const targetDateQuery = z.object({ target_date: targetDate })
