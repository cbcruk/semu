import { z } from 'zod'
import { plainDate } from '../shared/hr.schema'
import { EMPLOYMENT_TYPES } from '../shared/hr.utils'

/** Body of a certificate issuance. */
export const issueBody = z.object({
  template: z.number().int().positive(),
  employment_type: z.enum(EMPLOYMENT_TYPES as [string, ...string[]]).transform((value) => value as (typeof EMPLOYMENT_TYPES)[number]),
  employee_id: z.number().int().positive(),
  field_values: z.record(z.string(), z.unknown()).optional(),
  company_seal: z.number().int().positive().nullable().optional(),
})

/** Body of the send action; omitted recipients fall back to the employee's contacts. */
export const sendCertificateBody = z
  .object({
    email: z.email().optional(),
    phone: z.string().trim().regex(/^[0-9-]{9,14}$/, 'Enter a phone number.').optional(),
  })
  .optional()

/** Body of the bulk download. */
export const downloadBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) })

/** Query string of the certificate list and status counts. */
export const certificateListQuery = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  employee_id: z.coerce.number().int().positive().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Body of the recipient's identity check. */
export const certificateVerifyBody = z.object({ name: z.string().trim().min(1).max(100), birth_date: plainDate.optional() })
