import type { PlainDate } from '../../lib/plain-date.types'
import type { FilingKind, TaxType } from '../tax-calendar/tax-calendar.types'

/** Lifecycle state of a tax filing. */
export type FilingStatus =
  | 'scheduled'
  | 'requested'
  | 'submitted'
  | 'reviewing'
  | 'ledger_pending'
  | 'preparing'
  | 'filed'
  | 'settled'
  | 'cancelled'

/** How a settled filing ended. */
export type Settlement = 'paid' | 'refund' | 'no_payment'

/** Kind of document the agency attaches to a filing. */
export type DocType = 'ledger' | 'return' | 'payment_slip' | 'notice'

/** A client's answer to one requirement item. */
export type RequirementResponse = 'pending' | 'provided' | 'not_applicable'

/** Who performed an action. */
export interface Actor {
  type: 'client' | 'agency' | 'system'
  id: string | null
}

/** Names of the state transitions defined in `TRANSITIONS`. */
export type TransitionName =
  | 'request'
  | 'submit'
  | 'unsubmit'
  | 'startReview'
  | 'reject'
  | 'uploadLedger'
  | 'confirmLedger'
  | 'disputeLedger'
  | 'startPreparing'
  | 'file'
  | 'recordNotice'
  | 'pay'
  | 'close'
  | 'cancel'

/** Extra precondition checked before a transition. */
export type TransitionGuard =
  | 'noPendingClientItems'
  | 'isSurtax'
  | 'isNotSurtax'
  | 'hasReturnDocument'
  | 'isNoticeKind'
  | 'payableIsPositive'
  | 'payableIsNotPositive'

/** Allowed source states, target state, actor and guard of one transition. */
export interface TransitionRule {
  from: readonly FilingStatus[]
  to: FilingStatus
  actor: 'client' | 'agency'
  guard?: TransitionGuard
}

/** Optional inputs some transitions require. */
export interface TransitionInput {
  submitDue?: PlainDate
  reason?: string
  message?: string
  payableAmount?: number
  paymentDue?: PlainDate
  paidOn?: PlainDate
}

/** A row of the `tax_filings` table. */
export interface FilingRow {
  id: string
  company_id: string
  tax_type: TaxType
  kind: FilingKind
  tax_period_key: string
  revision: number
  year: number
  quarter: number | null
  period_start: PlainDate
  period_end: PlainDate
  statutory_due: PlainDate | null
  due_date: PlainDate | null
  payment_due: PlainDate | null
  submit_due: PlainDate | null
  status: FilingStatus
  payable_amount: number | null
  settlement: Settlement | null
  paid_on: PlainDate | null
  ledger_uploaded_at: string | null
  ledger_confirmed_at: string | null
  ledger_dispute_count: number
  payment_slip_sent_at: string | null
  version: number
  created_at: string
  updated_at: string
}

/** A row of the `filing_requirements` table. */
export interface RequirementRow {
  company_id: string
  filing_id: string
  code: string
  label: string
  response: RequirementResponse
  auto_linked: 0 | 1
  note: string | null
  updated_by: string | null
  updated_at: string | null
}

/** A row of the `files` table. */
export interface FileRow {
  id: string
  company_id: string
  storage_key: string
  original_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  uploaded_by: string
  created_at: string
}

/** A row of the `filing_documents` table. */
export interface DocumentRow {
  id: string
  company_id: string
  filing_id: string
  doc_type: DocType
  file_id: string
  first_viewed_at: string | null
  replaced_at: string | null
  created_at: string
}

/** A row of the `filing_events` table. */
export interface EventRow {
  id: number
  company_id: string
  filing_id: string
  actor_type: Actor['type']
  actor_id: string | null
  type: string
  from_status: FilingStatus | null
  to_status: FilingStatus | null
  payload: string | null
  created_at: string
}

/** One requirement template entry. */
export interface RequirementTemplate {
  code: string
  label: string
  autoLinked: boolean
}

/** A file received from a multipart request. */
export interface UploadInput {
  name: string
  bytes: Uint8Array
}

/** The legacy step a filing is in, for progress bars. */
export interface ProcessStepInfo {
  step: string | null
  index: number
  count: number
}
