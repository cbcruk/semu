/** Subscription products a company can buy. */
export type SubscriptionCode = 'tax' | 'payroll'

/** Lifecycle of a subscription: pending → active → cancelled (end scheduled) → ended. */
export type SubscriptionStatus = 'pending' | 'active' | 'cancelled' | 'ended'

/** A row of `company_subscriptions`. */
export interface SubscriptionRow {
  id: string
  company_id: string
  code: SubscriptionCode
  status: SubscriptionStatus
  started_on: string
  ended_on: string | null
  contract_id: string | null
  monthly_fee: number
  created_at: string
  updated_at: string
}

/** Requested change to a company's subscription. */
export interface SubscriptionChange {
  status: SubscriptionStatus
  startedOn: string
  endedOn: string | null
  monthlyFee: number
  contractId?: string | null
}

/** Payment states: scheduled → paid | failed → retrying → paid | failed; paid → refunded. */
export type PaymentStatus = 'scheduled' | 'paid' | 'failed' | 'retrying' | 'refunded'

/** A row of `payments`. */
export interface PaymentRow {
  id: number
  company_id: string
  subscription_code: SubscriptionCode
  amount: number
  scheduled_on: string
  attempted_on: string | null
  settled_at: string | null
  status: PaymentStatus
  mandate_id: string | null
  failure_reason: string | null
  refunded_at: string | null
  parent_payment_id: number | null
  created_at: string
}

/** A row of `billing_mandates` (CMS withdrawal consent). */
export interface MandateRow {
  id: string
  company_id: string | null
  business_number: string
  bank_code: string
  account_number_enc: string
  account_masked: string
  account_holder: string
  payer_id_enc: string
  consent_file_id: string | null
  source: 'upload' | 'online'
  status: 'pending' | 'registered' | 'rejected' | 'revoked'
  created_at: string
  registered_at: string | null
}
