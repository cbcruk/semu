import { z } from 'zod'
import { nullableDate, nullableText, plainDate } from '../shared/hr.schema'

const organizationRef = z
  .union([z.number().int().positive(), z.null()])
  .optional()
  .transform((value) => value ?? null)

const identityFields = {
  name: z.string().trim().min(1).max(100),
  english_name: nullableText(100),
  registration_number: z.string().trim().max(20).optional(),
  identification_number_type: z.enum(['registration', 'passport']).optional(),
  birth_date: nullableDate,
  email: z.union([z.literal(''), z.null(), z.email().max(254)]).optional(),
  phone: nullableText(20),
  is_local: z.boolean().optional(),
  nationality: nullableText(50),
  visa: nullableText(20),
  is_residence: z.boolean().optional(),
  country_of_residence: z.string().trim().min(1).max(50).optional(),
}

/** Query string shared by the wage employee list, export and status counts. */
export const employeeListQuery = z.object({
  status: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  ordering: z.string().max(100).optional(),
  date_type: z.enum(['join_date', 'leave_date', 'birth_date']).optional(),
  start_date: plainDate.optional(),
  end_date: plainDate.optional(),
  contract_filter: z.enum(['expiring_soon', 'expired']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Body of `POST wage-employees`: name, registration number and join date are required (rule R1). */
export const createWageEmployeeBody = z.object({
  ...identityFields,
  registration_number: z.string().trim().min(1).max(20),
  join_date: plainDate,
  work_code: nullableText(10),
  employee_number: nullableText(30),
  department: organizationRef,
  position: organizationRef,
  is_rejoin: z.boolean().optional(),
})

/** Body of `PATCH wage-employees/:id`: any subset of the registration fields. */
export const patchWageEmployeeBody = z
  .object({
    ...identityFields,
    join_date: plainDate,
    work_code: nullableText(10),
    employee_number: nullableText(30),
    department: organizationRef,
    position: organizationRef,
  })
  .partial()

/** Body of `PUT wage-employees/:id/common-info`; a masked or omitted registration number keeps the stored one. */
export const commonInfoBody = z.object(identityFields)

/** Body of the non-wage employee `PATCH` and create endpoints (신규 설계). */
export const nonWageEmployeeBody = z
  .object({
    ...identityFields,
    join_date: nullableDate,
    leave_date: nullableDate,
    daily_wage: z.number().int().min(0).nullable().optional(),
    business_code: nullableText(10),
    other_income_code: nullableText(10),
    bank_code: nullableText(10),
    account_number: z.string().trim().max(30).nullable().optional(),
    account_holder: nullableText(50),
    department: organizationRef,
    position: organizationRef,
  })
  .partial()
