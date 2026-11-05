/** Bill status: `todo` 납부 필요, `unknown` 확인 필요, `done` 납부 완료, `hidden` 숨김. */
export type GiroStatus = 'todo' | 'unknown' | 'done' | 'hidden'

/** Why a bill is done: paid in the app, marked by the user, or seen paid on a refresh. */
export type GiroDoneReason = 'paid_in_app' | 'manual' | 'scraped'

/** Values of `giro_actions.status`, starting with `created`. */
export type GiroActionStatus = 'created' | 'manual_done' | 'hide' | 'paid' | 'pay_failed' | 'unknown' | 'scraped_done' | 'reopened'

/** A row of `giros`. */
export interface GiroRow {
  id: string
  company_id: string
  e_pay_no: string
  giro_type: '국세' | '지방세'
  slip_type: string
  tax_name: string
  bill_org_name: string | null
  pay_amount: number
  due_date: string | null
  detail: string
  status: GiroStatus
  done_reason: GiroDoneReason | null
  memo: string
  status_updated_at: string
  created_at: string
  modified_at: string
}

/** A row of `giro_actions`. */
export interface GiroActionRow {
  id: string
  giro_id: string
  status: GiroActionStatus
  memo: string
  username: string
  approver_username: string
  created_at: string
}

/** A row of `giro_payments`; the account password is never stored. */
export interface GiroPaymentRow {
  id: string
  giro_id: string
  request_id: string
  bank_code: string
  account_number_enc: string
  account_number_tail: string
  amount: number
  status: 'requested' | 'succeeded' | 'failed'
  result_code: string | null
  result_message: string | null
  requested_by: string
  created_at: string
}

/** A bill as the internet giro scraper reports it, the input of {@linkcode upsertScrapedGiros}. */
export interface ScrapedGiroBill {
  /** 전자납부번호, the natural key of a bill within a company. */
  e_pay_no: string
  giro_type: '국세' | '지방세'
  slip_type: string
  tax_name: string
  bill_org_name?: string | null
  /** Amount due in won. */
  pay_amount: number
  /** 납기내 date (`pay_date1` for national tax, `pay_date` for local tax). */
  due_date?: string | null
  /** Source-specific fields kept verbatim, serialized with amounts as strings. */
  detail: Record<string, unknown>
  /** Whether the scraper saw the bill as already paid. */
  is_paid?: boolean
}

/** Counts of a scrape upsert. */
export interface GiroUpsertResult {
  inserted: number
  updated: number
  marked_unknown: number
}

/** What the payment gateway needs to pay one bill. */
export interface GiroPaymentRequest {
  companyId: string
  giroId: string
  ePayNo: string
  giroType: '국세' | '지방세'
  bankCode: string
  accountNumber: string
  /** Withdrawal account password, forwarded once and never persisted. */
  accountPassword: string
  amount: number
  requestId: string
}

/** Outcome of a payment request. */
export interface GiroPaymentResult {
  ok: boolean
  result_code: string
  result_message: string
}

/** Internet giro payment gateway, kept behind an interface so tests use a fake. */
export interface GiroPaymentAdapter {
  /** Pays a bill from a withdrawal account and waits for the bank's answer. */
  pay(request: GiroPaymentRequest): Promise<GiroPaymentResult>
}

/** One tax payment reminder to deliver. */
export interface TaxAlertMessage {
  companyId: string
  userId: string
  kind: 'tax_payment_due'
  giroId: string
  taxName: string
  payAmount: number
  dueDate: string
  /** Days from today to the due date, 0 on the due date. */
  daysLeft: number
}

/** Delivery channel for tax payment reminders (KakaoTalk, mail). */
export interface TaxAlertNotifier {
  /** Sends one reminder. */
  send(message: TaxAlertMessage): Promise<void>
}

/** Counts of one tax payment alert run. */
export interface TaxAlertRunResult {
  sent: number
  skipped: number
  /** Whether the run was skipped because today is not a business day. */
  holiday: boolean
}

/** A withdrawal account the user can pick in the payment dialog. */
export interface PaymentAccountCandidate {
  /** Opaque reference to pass back as `payment_account_id`. */
  id: string
  source: 'recent' | 'registered'
  bank_code: string
  account_number: string
  account_name: string | null
}

/** A registered bank account usable for withdrawals. */
export interface RegisteredBankAccount {
  id: string
  bank_code: string
  account_number_enc: string
  account_name: string | null
}

/** Input of `payGiro`; exactly one of `paymentAccountId` and the bank code and number pair is set. */
export interface PayGiroInput {
  paymentAccountId?: string | undefined
  bankCode?: string | undefined
  accountNumber?: string | undefined
  accountPassword: string
  amount?: number | undefined
  requestId?: string | undefined
}
