import { z } from 'zod'

/** Query string of the bill list. */
export const listGirosQuery = z.object({
  status: z.enum(['todo', 'unknown', 'done', 'hidden']).optional(),
  search: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Body of `manual_done` and `hide`; the client always sends an empty memo. */
export const giroActionBody = z.object({ memo: z.string().max(500).default('') })

/** Body of a v2 payment; `account_password` is forwarded to the gateway and never stored. */
export const payGiroBody = z
  .object({
    payment_account_id: z.string().optional(),
    bank_code: z.string().regex(/^\d{3}$/, 'Use a 3-digit bank code.').optional(),
    account_number: z.string().regex(/^[\d-]{6,20}$/, 'Use digits only.').optional(),
    account_password: z.string().regex(/^\d{4}$/, 'Use the 4-digit account password.'),
    amount: z.number().int().positive().optional(),
    request_id: z.string().min(1).max(64).optional(),
  })
  .refine((body) => body.payment_account_id !== undefined || (body.bank_code !== undefined && body.account_number !== undefined), {
    message: 'Choose a payment account or enter a bank code and account number.',
    path: ['account_number'],
  })
