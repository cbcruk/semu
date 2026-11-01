import { z } from 'zod'

/** Rule scope parameter. */
export const ruleScope = z.enum(['sales', 'purchase', 'bank'])

const won = z.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.')

/** One rule condition. */
export const ruleCondition = z.object({
  field: z.enum(['partner', 'counterparty', 'item', 'total_amount', 'supply_amount', 'vat_amount', 'source', 'summary', 'amount', 'account', 'direction']),
  op: z.enum(['in', 'contains', 'starts_with', 'equals', 'gte', 'lte', 'between']),
  values: z.array(z.string().min(1).max(100)).max(50).optional(),
  min: won.optional(),
  max: won.optional(),
})

/** Query string of the rule list. */
export const ruleListQuery = z.object({ scope: ruleScope, include_hidden: z.enum(['true', 'false']).optional() })

/** Body that creates a rule. */
export const ruleCreateBody = z.object({
  scope: ruleScope,
  source: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(50),
  conditions: z.array(ruleCondition).min(1).max(20),
  result_account_title_id: z.string().min(1).nullable().optional(),
  result_partner_id: z.string().min(1).nullable().optional(),
})

/** Body that edits or hides a rule. */
export const ruleUpdateBody = ruleCreateBody.omit({ scope: true }).partial().extend({ is_hidden: z.boolean().optional() })

/** Body that reorders a scope's rules. */
export const ruleOrderBody = z.object({ scope: ruleScope, ids: z.array(z.string().min(1)).max(500) })

/** Body of the live rule preview. */
export const rulePreviewBody = z.object({
  scope: ruleScope,
  source: z.string().min(1).nullable().optional(),
  conditions: z.array(ruleCondition).min(1).max(20),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
})

/** Body that applies rules to existing rows. */
export const ruleApplyBody = z.object({ scope: ruleScope, mode: z.enum(['fill_empty', 'overwrite']), rule_id: z.string().min(1).optional() })
