import { z } from 'zod'
import { plainDateParam } from '../bookkeeping.utils'

const personName = z.string().trim().min(1).max(30)
const optionalText = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> => z.string().trim().max(max).nullable().optional()

const bankAccount = z.object({
  id: z.string().optional(),
  bank_code: z.string().regex(/^\d{3}$/, 'Use the three-digit bank code.'),
  account_number: z.string().regex(/^[\d-]{6,20}$/, 'Use digits only.').optional(),
  account_name: optionalText(30),
  bankbook_image_path: optionalText(200),
  is_primary: z.boolean().optional(),
})

const contact = z.object({
  name: personName,
  department: optionalText(30),
  email: z.email().nullable().optional(),
  phone_number: optionalText(20),
  mobile_number: optionalText(20),
  fax_number: optionalText(20),
})

const partnerFields = {
  partner_type: z.enum(['business', 'individual']),
  business_entity_type: z.enum(['corporation', 'individual']).nullable().optional(),
  sales: z.boolean(),
  purchased: z.boolean(),
  name: personName,
  representative_name: personName,
  business_number: z
    .string()
    .regex(/^\d{10}$/, 'Use the ten-digit business number without hyphens.')
    .nullable()
    .optional(),
  business_type: optionalText(50),
  business_class: optionalText(50),
  address: optionalText(200),
  phone_number: optionalText(20),
  memo: optionalText(1000),
  representative_image_path: optionalText(200),
  bank_accounts: z.array(bankAccount).max(10).optional(),
  contacts: z.array(contact).max(20).optional(),
}

/** Body that registers a partner. */
export const createPartnerBody = z
  .object(partnerFields)
  .refine((body) => body.sales || body.purchased, { message: 'Choose 매출처, 매입처 or both.', path: ['sales'] })
  .refine((body) => body.partner_type === 'individual' || (body.business_number ?? null) !== null, {
    message: 'Business partners need a business number.',
    path: ['business_number'],
  })

/** Body that edits a partner; lists replace the stored ones, keeping accounts sent back by `id` without a number. */
export const updatePartnerBody = z.object(partnerFields).partial()

/** Query string of the partner list. */
export const partnerListQuery = z.object({
  search: z.string().max(50).optional(),
  kind: z.enum(['sales', 'purchase']).optional(),
  sort: z.enum(['created', '-created', 'name', '-name']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Query string of a partner's history tabs. */
export const historyQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  start_date: plainDateParam.optional(),
  end_date: plainDateParam.optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Query string of the NTS business status lookup. */
export const businessStatusQuery = z.object({ business_number: z.string().regex(/^\d{10}$/, 'Use the ten-digit business number without hyphens.') })
