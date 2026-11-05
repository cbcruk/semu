import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../../lib/plain-date'
import { PL_BASE_SECTIONS } from './settlement.utils'

const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)
const won = z.number().int().refine(Number.isSafeInteger, 'Amount is out of range.')
const month = z.number().int().min(1).max(12)
const cashAccount = z.enum(['현금', '당좌예금', '보통예금', '제예금'])
const kind = z.enum(['receivable', 'payable'])
const text = z.string().max(500)

/** Path parameters of yearly report routes. */
export const yearParam = z.object({ year: z.coerce.number().int().min(2000).max(2100) })

/** Path parameters of a partner ledger route. */
export const partnerParam = yearParam.extend({ partnerId: z.string().min(1).max(50) })

/** Path parameters of the agency upload route. */
export const uploadParam = z.object({
  companyId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  scope: z.enum(['pl', 'bs', 'cash', 'ar_ap']),
})

/** Query string of the page-number partner lists. */
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1) })

/** Upload body of the profit and loss scope; derived sections are computed and must not be sent. */
export const plUpload = z.object({
  closed_through: plainDate,
  lines: z
    .array(
      z.object({
        month,
        section: z.enum(PL_BASE_SECTIONS),
        path: z.string().max(200).refine((path) => !path.startsWith('/') && !path.endsWith('/') && !path.includes('//'), 'Malformed account path.'),
        amount: won,
      }),
    )
    .max(20_000),
})

/** Upload body of the balance sheet scope. */
export const bsUpload = z.object({
  closed_through: plainDate,
  rows: z
    .array(
      z.object({
        target_month: plainDate.refine((date) => date.endsWith('-01'), 'Use the first day of the month.'),
        subject: z.string().min(1).max(100),
        parent_subject: z.string().min(1).max(100).nullable(),
        sort_order: z.number().int(),
        amount: won,
      }),
    )
    .max(20_000),
})

/** Upload body of the cash flow scope. */
export const cashUpload = z.object({
  closed_through: plainDate,
  ledger: z.array(z.object({ month, cash_account: cashAccount, inflow: won, outflow: won, closing_balance: won })).max(1000),
  entries: z
    .array(z.object({ date: plainDate, cash_account: cashAccount, summary: text.nullable(), inflow: won, outflow: won, balance: won }))
    .max(50_000)
    .default([]),
})

/** Upload body of the receivable and payable scope. */
export const arApUpload = z.object({
  closed_through: plainDate,
  balances: z
    .array(
      z.object({
        kind,
        month,
        erp_partner_code: z.string().min(1).max(50),
        partner_name: z.string().min(1).max(200),
        summary: text.nullable(),
        entry_count: z.number().int().min(0),
        rollover_balance: won,
        increase_amount: won,
        decrease_amount: won,
        balance: won,
      }),
    )
    .max(50_000),
  entries: z
    .array(
      z.object({ kind, erp_partner_code: z.string().min(1).max(50), date: plainDate, summary: text.nullable(), transaction_amount: won, balance: won }),
    )
    .max(100_000)
    .default([]),
})
