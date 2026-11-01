import { z } from 'zod'
import { isPlainDate } from '../../../lib/plain-date'

const won = z.number().int().refine(Number.isSafeInteger, 'Amount is out of range.')
const text = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> => z.string().max(max).nullable().optional()
const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.')

const item = z.object({
  month: z.string().regex(/^(0[1-9]|1[0-2])$/, 'Expected MM.'),
  day: z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, 'Expected DD.'),
  name: z.string().trim().min(1).max(100),
  specification: text(60),
  quantity: z.string().max(20).nullable().optional(),
  unit_price: won.nullable().optional(),
  supply_amount: won,
  tax_amount: won,
  description: text(100),
})

/** Fields of a statement body, shared by create and update. */
export const transactionFields = {
  partner_id: z.string().nullable().optional(),
  class_code: z.enum(['01', '02', '03', '04']).default('01'),
  kind_code: z.enum(['01', '02', '03', '04']).default('01'),
  buyer_class_code: z.enum(['01', '02', '03']).default('01'),
  purpose: z.enum(['01', '02']).default('02'),
  write_date: plainDate,
  description: text(150),
  cash: won.nullable().optional(),
  check_bill: won.nullable().optional(),
  note: won.nullable().optional(),
  crit: won.nullable().optional(),
  supplier_business_number: z.string().regex(/^\d{10}$/, 'Use 10 digits without hyphens.').optional(),
  supplier_branch_number: text(4),
  supplier_company_name: z.string().max(70).optional(),
  supplier_representative_name: z.string().max(30).optional(),
  supplier_address: text(150),
  supplier_business_type: text(40),
  supplier_business_class: text(40),
  supplier_email: z.email().nullable().optional(),
  supplier_contact_name: text(30),
  supplier_contact_part: text(30),
  supplier_mobile_number: text(20),
  supplier_phone_number: text(20),
  buyer_business_number: z.string().regex(/^\d{10}$|^\d{13}$/, 'Use 10 or 13 digits without hyphens.'),
  buyer_branch_number: text(4),
  buyer_company_name: z.string().trim().min(1).max(70),
  buyer_representative_name: z.string().trim().min(1).max(30),
  buyer_address: text(150),
  buyer_business_type: text(40),
  buyer_business_class: text(40),
  buyer_email: z.email().nullable().optional(),
  buyer_email_sub: z.email().nullable().optional(),
  buyer_contact_name: text(30),
  buyer_contact_part: text(30),
  buyer_mobile_number: text(20),
  buyer_phone_number: text(20),
  items: z.array(item).min(1).max(16),
  grand_total_amount: won,
  charge_total_amount: won,
  tax_total_amount: won,
}

/** Body of a new transaction statement. */
export const createTransactionBody = z.object(transactionFields)

/** Body of a statement update; omitted fields keep their values. */
export const patchTransactionBody = z.object(transactionFields).partial()

/** Parsed statement body. */
export type TransactionBody = z.infer<typeof createTransactionBody>

const booleanParam = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1')

/** Query string of statement lists and summaries. */
export const listTransactionsQuery = z.object({
  search: z.string().optional(),
  start_date: plainDate.optional(),
  end_date: plainDate.optional(),
  is_issued_invoice: booleanParam.optional(),
  issue_invoice_type: z.enum(['normal', 'modify']).optional(),
  invoice_type: z.enum(['01', '02', '03', '04']).optional(),
  sort: z.enum(['created', '-created', 'write_date', '-write_date', 'grand_total_amount', '-grand_total_amount']).default('-created'),
  limit: z.string().optional(),
  offset: z.string().optional(),
})
