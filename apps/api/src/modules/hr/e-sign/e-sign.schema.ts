import { z } from 'zod'
import { looseBoolean, nullableDate, plainDate } from '../shared/hr.schema'
import { EMPLOYMENT_TYPES } from '../shared/hr.utils'

const employmentType = z.enum(EMPLOYMENT_TYPES as [string, ...string[]]).transform((value) => value as (typeof EMPLOYMENT_TYPES)[number])
const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value))
const optionalId = z.number().int().positive().nullable().optional()

/** Query string of the template list. */
export const templateListQuery = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  is_active: looseBoolean.optional(),
  is_certificate: looseBoolean.optional(),
})

/** Body of a template edit; every field is optional. */
export const templatePatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.array(z.object({ type: z.enum(['heading', 'paragraph', 'clause']), text: z.string().max(5000) })).optional(),
  field_defaults: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  is_active: z.boolean().optional(),
  default_seal: optionalId,
})

const notiRecipient = z.object({
  name: z.string().trim().min(1).max(100),
  position: optionalId.transform((value) => value ?? null),
  phone: z.string().trim().regex(/^[0-9-]{9,14}$/, 'Enter a phone number.'),
  email: z.email().nullable().optional().or(z.literal('')).transform((value) => (value === undefined || value === '' ? null : value)),
})

/** Body of the notification recipients replacement: an array, or `{recipients: [...]}`; at most three. */
export const notiRecipientsBody = z
  .union([z.array(notiRecipient), z.object({ recipients: z.array(notiRecipient) })])
  .transform((value) => (Array.isArray(value) ? value : value.recipients))
  .refine((list) => list.length <= 3, 'Register up to three recipients.')

const recipient = z.object({
  employment_type: employmentType.nullable().optional(),
  employee_id: optionalId,
  name: z.string().trim().min(1).max(100).optional(),
  email: z.email().nullable().optional().or(z.literal('')).transform((value) => (value === undefined || value === '' ? null : value)),
  phone: optionalText,
  is_local: z.boolean().default(true),
  nationality: optionalText,
  visa: optionalText,
  birth_date: nullableDate,
})

const draftFields = {
  templates: z
    .array(z.object({ template_type: z.enum(['e_sign_template', 'company_e_sign_template']).optional(), template_id: z.number().int().positive() }))
    .min(1)
    .max(10),
  workplace_size: z.enum(['gte5', 'lt5']).nullable().optional(),
  recipient,
  wage_type: z.enum(['monthly', 'daily', 'hourly']).nullable().optional(),
  work_condition: optionalId,
  work_schedule_policy: optionalId,
  field_values: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  company_seal: optionalId,
  due_date: nullableDate,
  send: z.boolean().optional(),
}

/** Body of a new e-sign request; `send: true` sends it immediately. */
export const requestCreateBody = z.object(draftFields)

/** Body of a draft edit; `send: true` also sends it and then requires `If-Match`. */
export const requestPatchBody = z.object({
  ...draftFields,
  templates: draftFields.templates.optional(),
  recipient: recipient.optional(),
})

/** Query string of the e-sign request list. */
export const requestListQuery = z.object({
  date_type: z.enum(['requested_at', 'signed_at']).optional(),
  start_date: plainDate.optional(),
  end_date: plainDate.optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  employee_name: z.string().optional(),
  search: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Body of the explicit send action. */
export const sendBody = z.object({ due_date: nullableDate }).optional()

/** Body of the signer's identity check. */
export const verifyBody = z.object({ name: z.string().trim().min(1).max(100), birth_date: plainDate.optional() })

/** Body of the signer's completion. */
export const completeBody = z.object({
  documents: z
    .array(z.object({ index: z.number().int().min(0), field_values: z.record(z.string(), z.unknown()).optional(), seal_id: z.number().int().positive() }))
    .min(1),
  leaving_reason: z.string().max(20).optional(),
  leaving_detail_reason: z.string().max(20).optional(),
  agreed_at: z.string().max(40).optional(),
})
