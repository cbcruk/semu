import { z } from 'zod'
import { plainDateParam, stringListParam } from '../bookkeeping.utils'

/** Query string of the bank account list. */
export const accountListQuery = z.object({ include_inactive: z.enum(['true', 'false']).optional() })

/** Body that edits a bank account's alias and cash report visibility. */
export const accountPatchBody = z.object({
  account_name: z.string().trim().max(30).nullable().optional(),
  is_visible_on_cash_report: z.boolean().optional(),
})

/** Query string of an account's daily balances. */
export const balanceQuery = z.object({ start_date: plainDateParam.optional(), end_date: plainDateParam.optional() })

/** Query string of the bank transaction list and export. */
export const transactionListQuery = z.object({
  start_date: plainDateParam.optional(),
  end_date: plainDateParam.optional(),
  direction: z.enum(['deposit', 'withdrawal']).optional(),
  account_id: stringListParam.optional(),
  account_title_id: stringListParam.optional(),
  classification_status: z.enum(['classified', 'unclassified']).optional(),
  partner_id: z.string().optional(),
  search: z.string().max(50).optional(),
  sort: z.enum(['transacted_at', '-transacted_at', 'amount', '-amount']).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Validated query of the bank transaction list. */
export type TransactionListQuery = z.infer<typeof transactionListQuery>

/** Body that classifies one bank transaction. */
export const transactionPatchBody = z.object({
  account_title_id: z.string().min(1).nullable().optional(),
  partner_id: z.string().min(1).nullable().optional(),
  memo: z.string().max(50).nullable().optional(),
})

/** Body that classifies many bank transactions. */
export const bulkClassifyBody = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    account_title_id: z.string().min(1).nullable().optional(),
    partner_id: z.string().min(1).nullable().optional(),
  })
  .refine((body) => body.account_title_id !== undefined || body.partner_id !== undefined, {
    message: 'Send account_title_id, partner_id or both.',
    path: ['account_title_id'],
  })

/** Body that links a bank transaction to evidence. */
export const settlementBody = z
  .array(
    z.object({
      evidence_side: z.enum(['sales', 'purchase']),
      evidence_id: z.string().min(1),
      amount: z.number().int().positive().refine(Number.isSafeInteger, 'Amount is out of range.'),
    }),
  )
  .min(1)
