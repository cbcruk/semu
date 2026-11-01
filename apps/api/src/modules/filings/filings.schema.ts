import { z } from 'zod'
import { isPlainDate, toPlainDate } from '../../lib/plain-date'

const plainDate = z.string().refine(isPlainDate, 'Expected a YYYY-MM-DD date.').transform(toPlainDate)
const won = z.number().int().refine(Number.isSafeInteger, 'Amount is out of range.')
const reason = z.string().trim().min(1).max(1000)

/** Query string of filing lists. */
export const listFilingsQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/** Query string of the yearly calendar. */
export const calendarQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) })

/** Body of a client's answer to a requirement item. */
export const requirementBody = z.object({
  response: z.enum(['pending', 'not_applicable']),
  note: z.string().max(1000).nullable().optional(),
})

/** Body of a client's ledger dispute. */
export const disputeBody = z.object({ reason })

/** Body of a client's payment confirmation. */
export const payBody = z.object({ paid_on: plainDate })

/** Body of an agency request for materials. */
export const requestBody = z.object({ submit_due: plainDate, message: z.string().max(1000).optional() })

/** Body of an agency rejection. */
export const rejectBody = z.object({ reason, submit_due: plainDate })

/** Body of an agency filing completion. */
export const fileBody = z.object({ payable_amount: won, payment_due: plainDate.optional() })

/** Body of an agency cancellation. */
export const cancelBody = z.object({ reason })

/** Text fields of the multipart request that records a notice. */
export const noticeFields = z.object({
  payable_amount: z.coerce.number().int().min(0).refine(Number.isSafeInteger, 'Amount is out of range.'),
  payment_due: plainDate,
})

/** Text fields of the multipart request that uploads an agency document. */
export const documentFields = z.object({ doc_type: z.enum(['return', 'payment_slip']) })

/** Query string of the agency work queue. */
export const queueQuery = z.object({
  status: z.enum(['scheduled', 'requested', 'submitted', 'reviewing', 'ledger_pending', 'preparing', 'filed']).optional(),
  due_before: plainDate.optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})
