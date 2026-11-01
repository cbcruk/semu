import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'
import { isYearMonth } from '../engine/rate-table'

const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)
const yearMonth = z.string().refine(isYearMonth, 'Expected a YYYY-MM month.')
const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')
const hours = z.number().min(0).max(744)
const id = z.number().int().positive()
const title = z.string().trim().min(1).max(100)

/** A payment or deduction item amount on a row. */
export const itemAmountSchema = z.object({ item_id: id, amount: z.number().int().refine(Number.isSafeInteger, 'Amount is out of range.') })

/** Manual amounts entered over a calculation. */
export const overridesSchema = z.object({
  national_pension: won.nullable().optional(),
  health_insurance: won.nullable().optional(),
  long_term_care: won.nullable().optional(),
  employment_insurance: won.nullable().optional(),
  income_tax: won.nullable().optional(),
  local_income_tax: won.nullable().optional(),
})

/** A wage row's work sheet values; omitted values keep what is stored. */
export const workInfoSchema = z.object({
  regular_hours: hours.optional(),
  overtime_hours: hours.optional(),
  night_hours: hours.optional(),
  holiday_hours: hours.optional(),
  holiday_overtime_hours: hours.optional(),
  absence_hours: hours.optional(),
  weekly_holiday_deduction_days: z.number().int().min(0).max(6).optional(),
  weekly_holiday_weeks: z.number().int().min(0).max(6).optional(),
})

/** Fields a wage row accepts in `PUT payroll-input/:r` and `payroll-input/update`. */
export const wageRowPatchSchema = z.object({
  base_pay: won.optional(),
  hourly_wage: won.optional(),
  daily_wage: won.optional(),
  worked_days: z.number().int().min(0).max(31).optional(),
  prorate_requested: z.boolean().optional(),
  proration: z.object({ payable_days: z.number().int().min(0).max(31), total_days: z.number().int().min(1).max(31) }).nullable().optional(),
  payment_items: z.array(itemAmountSchema).optional(),
  deduction_items: z.array(itemAmountSchema).optional(),
  work: workInfoSchema.optional(),
  insurance_notice: z
    .object({ national_pension: won.optional(), health_insurance: won.optional(), long_term_care: won.optional(), employment_insurance: won.optional() })
    .optional(),
  overrides: overridesSchema.optional(),
  email: z.email().nullable().optional(),
})

/** Body of `POST payroll-input/update`: several wage rows by ID. */
export const wageRowsUpdateBody = z.object({ rows: z.array(wageRowPatchSchema.extend({ id })).min(1).max(500) })

/** Fields of a daily, business or other income row in `POST payroll-input`. */
export const simpleRowSchema = z.object({
  id: id.optional(),
  employee_id: id.nullable().optional(),
  name: z.string().trim().min(1).max(50).optional(),
  resident_number: z.string().trim().max(20).nullable().optional(),
  is_foreigner: z.boolean().optional(),
  residence_country: z.string().trim().min(2).max(2).optional(),
  payment_date: plainDate.nullable().optional(),
  email: z.email().nullable().optional(),
  pay_amount: won.optional(),
  work_dates: z.array(plainDate).max(31).optional(),
  work_days: z.number().int().min(1).max(31).nullable().optional(),
  avg_daily_hours: z.number().min(0).max(24).nullable().optional(),
  is_owner_or_cohabiting_relative: z.boolean().optional(),
  deduction_items: z.array(itemAmountSchema).optional(),
  business_income_type_code: z.string().max(10).nullable().optional(),
  detail_type: z.enum(['artist', 'special']).nullable().optional(),
  employment_insurance_applicable: z.boolean().optional(),
  contract_type: z.string().max(30).nullable().optional(),
  short_term_work_dates: z.array(plainDate).max(31).optional(),
  special_occ_type_code: z.string().max(10).nullable().optional(),
  tax_deduction_mode: z.enum(['before_tax', 'after_tax']).optional(),
  other_income_type_code: z.string().max(10).nullable().optional(),
  necessary_expense_amount: won.nullable().optional(),
  overrides: overridesSchema.optional(),
})

/** Body of `POST payroll-input` for daily, business and other income. */
export const simpleRowsBody = z.object({ rows: z.array(simpleRowSchema).min(1).max(500) })

/** Body of the row actions that take IDs (`calculate`, `delete`, `refresh-employee-info`, `reset-calculation`). */
export const rowIdsBody = z.object({ ids: z.array(id).max(500).optional() })

/** Body of `POST payroll-input/candidates`. */
export const candidatesBody = z.object({ employee_ids: z.array(id).min(1).max(500) })

/** Body of `POST work-input`: work sheet values per row. */
export const workInputBody = z.object({
  rows: z
    .array(
      workInfoSchema.extend({
        id,
        worked_days: z.number().int().min(0).max(31).optional(),
        work_dates: z.array(plainDate).max(31).optional(),
        avg_daily_hours: z.number().min(0).max(24).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
})

/** Body of `POST payment-items/bulk` and `deduction-items/bulk`. */
export const itemsBulkBody = z.object({
  employment_type: z.string().max(20).optional(),
  items: z.array(z.object({ id, is_enabled: z.boolean().optional(), amount: z.number().int().min(0).optional() })).min(1).max(200),
})

/** Query of `payment-items` and `deduction-items`. */
export const itemsQuery = z.object({ employment_type: z.string().max(20).optional() })

/** Body of `POST card`. */
export const createCardBody = z.object({
  attribution_month: yearMonth,
  payment_date: plainDate.optional(),
  title: title.optional(),
})

/** Body of `PUT card/:c`; a `status` change requires `If-Match`. */
export const putCardBody = z.object({
  title: title.optional(),
  payment_date: plainDate.optional(),
  status: z.enum(['inputting', 'calculated']).optional(),
})

/** Query of `card-summary`. */
export const cardSummaryQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(['inputting', 'calculated', 'approval_requested', 'approved', 'payslips_sent', 'exported']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Query of `payment-date-list`. */
export const paymentDateListQuery = z.object({ attribution_month: yearMonth.optional() })

/** Query of `export-to-desk`. */
export const exportQuery = z.object({ export_type: z.enum(['payroll_ledger', 'journal']).default('payroll_ledger') })

/** Body of `POST payslip/download`. */
export const payslipDownloadBody = z.object({
  row_ids: z.array(id).min(1).max(500),
  income_type: z.enum(['wage', 'business', 'daily', 'other']).optional(),
})

/** Body of `POST payslip/send` and the legacy notifications endpoint. */
export const payslipSendBody = z.object({ row_ids: z.array(id).min(1).max(500) })

/** Body of `POST manager-memo`. */
export const managerMemoBody = z.object({ content: z.string().max(10_000) })

/** Body of `POST shiftee-integration`. */
export const shifteeBody = z.object({
  company_name: z.string().trim().min(1).max(100).optional(),
  representative_name: z.string().trim().min(1).max(50).optional(),
  email: z.email(),
})
