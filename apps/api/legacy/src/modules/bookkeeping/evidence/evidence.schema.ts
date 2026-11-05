import { z } from 'zod'
import { plainDateParam, stringListParam } from '../bookkeeping.utils'

/** Path parameter naming the evidence side. */
export const sideParam = z.enum(['sales', 'purchase'])

/** Query string of the evidence list and export. */
export const evidenceListQuery = z.object({
  source: stringListParam.optional(),
  start_date: plainDateParam.optional(),
  end_date: plainDateParam.optional(),
  classification_status: z.enum(['classified', 'unclassified']).optional(),
  account_title_id: stringListParam.optional(),
  doc_type: z.enum(['tax_invoice', 'modified_tax_invoice', 'invoice', 'modified_invoice']).optional(),
  kind: z.enum(['normal', 'zero_rate', 'delegation', 'zero_rate_delegation']).optional(),
  partner_id: z.string().optional(),
  search: z.string().max(50).optional(),
  sort: z.enum(['written_on', '-written_on', 'issued_on', '-issued_on', 'total_amount', '-total_amount']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Validated query of the evidence list. */
export type EvidenceListQuery = z.infer<typeof evidenceListQuery>

/** Body that classifies one evidence record. */
export const evidencePatchBody = z.object({
  account_title_id: z.string().min(1).nullable().optional(),
  partner_id: z.string().min(1).nullable().optional(),
  memo: z.string().max(200).nullable().optional(),
  deductible: z.boolean().nullable().optional(),
})

/** Body that classifies many evidence records. */
export const evidenceBulkBody = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    account_title_id: z.string().min(1).nullable().optional(),
    partner_id: z.string().min(1).nullable().optional(),
  })
  .refine((body) => body.account_title_id !== undefined || body.partner_id !== undefined, {
    message: 'Send account_title_id, partner_id or both.',
    path: ['account_title_id'],
  })
