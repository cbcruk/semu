/** A CMS withdrawal mandate as sent to the billing gateway. */
export interface MandateRequest {
  mandateId: string
  businessNumber: string
  bankCode: string
  accountNumber: string
  accountHolder: string
  payerId: string
}

/** A single withdrawal attempt. */
export interface WithdrawalRequest {
  paymentId: number
  amount: number
  bankCode: string
  accountNumber: string
  accountHolder: string
}

/** Outcome of a gateway call. */
export type BillingOutcome = { ok: true } | { ok: false; reason: string }

/** CMS auto-debit gateway that registers mandates and withdraws subscription fees. */
export interface BillingAdapter {
  /** Registers a withdrawal mandate with the bank network. */
  registerMandate(request: MandateRequest): Promise<BillingOutcome>
  /** Withdraws one payment; results arrive the next business day in production. */
  withdraw(request: WithdrawalRequest): Promise<BillingOutcome>
}
