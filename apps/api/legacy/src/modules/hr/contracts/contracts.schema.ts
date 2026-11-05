import { z } from 'zod'
import { nullableDate, nullableText, plainDate, won } from '../shared/hr.schema'

const nullableId = z
  .union([z.number().int().positive(), z.null()])
  .optional()
  .transform((value) => value ?? null)

const fixedHours = z.number().min(0).max(300).default(0)

/** Body of `POST`/`PUT work-contracts`. */
export const workContractBody = z.object({
  contract_type: z.enum(['regular', 'contract']),
  start_date: plainDate,
  end_date: nullableDate,
  work_type: z.enum(['regular', 'part_time', 'short_time']).default('regular'),
  work_code: nullableText(10),
  work_condition: nullableId,
  work_schedule_policy: nullableId,
  weekly_work_hours: z.number().min(0).max(168).nullable().optional().transform((value) => value ?? null),
  has_probation: z.boolean().default(false),
  probation_months: z.number().int().min(1).max(12).nullable().optional().transform((value) => value ?? null),
  probation_pay_rate: z.number().int().min(90).max(100).nullable().optional().transform((value) => value ?? null),
  job_description: nullableText(1000),
  document: nullableId,
})

/** Body of `POST`/`PUT payroll-contracts`. */
export const payrollContractBody = z.object({
  start_date: plainDate,
  end_date: nullableDate,
  wage_type: z.enum(['monthly', 'daily', 'hourly']),
  monthly_work_hours_source: z.enum(['policy', 'manual']).default('manual'),
  monthly_work_hours: z.number().positive().max(744).default(209),
  daily_work_hours: z.number().positive().max(24).nullable().optional().transform((value) => value ?? null),
  amount: won,
  payment_items: z
    .array(
      z.object({
        payment_item: z.union([z.number().int(), z.string().min(1).max(50)]),
        name: z.string().max(100).optional(),
        is_enabled: z.boolean(),
        amount: won,
        is_ordinary_wage: z.boolean().optional(),
        counts_toward_minimum_wage: z.boolean().optional(),
      }),
    )
    .max(50)
    .default([]),
  fixed_wage_auto_calc: z.boolean().default(false),
  fixed_overtime_enabled: z.boolean().default(false),
  fixed_overtime_hours: fixedHours,
  fixed_overtime_amount: won.default(0),
  fixed_night_enabled: z.boolean().default(false),
  fixed_night_hours: fixedHours,
  fixed_night_amount: won.default(0),
  fixed_holiday_enabled: z.boolean().default(false),
  fixed_holiday_hours: fixedHours,
  fixed_holiday_amount: won.default(0),
  fixed_holiday_overtime_enabled: z.boolean().default(false),
  fixed_holiday_overtime_hours: fixedHours,
  fixed_holiday_overtime_amount: won.default(0),
  annual_salary: won.nullable().optional().transform((value) => value ?? null),
  has_bonus: z.boolean().default(false),
  bonus_amount: won.nullable().optional().transform((value) => value ?? null),
  bonus_in_ordinary_wage: z.boolean().default(false),
  pay_month: z.enum(['current', 'next']).default('current'),
  pay_day: z.number().int().min(1).max(31).default(25),
  pay_method: z.enum(['transfer', 'direct']).default('transfer'),
  bank_code: nullableText(10),
  account_number: z.string().trim().max(30).nullable().optional(),
  account_holder: nullableText(50),
})
