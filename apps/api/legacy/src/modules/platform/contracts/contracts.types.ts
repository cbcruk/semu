/** Direct contract states: draft → identity_verified → sms_verified → form_requested → signed → active, or expired before signing. */
export type ContractStatus = 'draft' | 'identity_verified' | 'sms_verified' | 'form_requested' | 'signed' | 'active' | 'expired'

/** Inputs of the bookkeeping fee calculation, using the legacy enum values. */
export interface FeeInputs {
  revenue: string
  employee_number: 'under_10' | 'from_10_to_20' | 'from_21_to_30' | 'from_31_to_50' | 'above_50'
  business_type: 'etc' | 'construction' | 'manufacturing' | 'trade' | 'lending' | 'other_professional_service'
  accounting_period: 'annual' | 'semi_annual' | 'quarterly' | 'monthly'
  diligent_business: 'no' | 'yes'
}

/** Result of the fee calculation in whole won, VAT excluded. */
export interface FeeQuote {
  monthlyFee: number
  adjustmentFee: number
  breakdown: { base: number; employees: number; industryBasisPoints: number; accountingPeriod: number; diligent: number }
}

/** A row of `bookkeeping_contracts`. */
export interface ContractRow {
  id: string
  company_id: string | null
  business_number: string | null
  representative_phone: string | null
  fee_inputs: string
  monthly_fee: number
  adjustment_fee: number
  status: ContractStatus
  form: string | null
  signature: string | null
  kind: 'online' | 'paper'
  auto_renew: 0 | 1
  effective_on: string | null
  identity_verified_at: string | null
  sms_verified_at: string | null
  form_requested_at: string | null
  signed_at: string | null
  created_at: string
  expires_at: string
}

/** A row of `signup_invitations`. */
export interface SignupInvitationRow {
  id: string
  token_hash: string
  email: string
  company_name: string | null
  business_number: string | null
  business_type: 'corporate' | 'individual' | null
  agency_id: string | null
  contract_id: string | null
  status: 'issued' | 'email_verified' | 'agreed' | 'completed' | 'expired' | 'revoked'
  user_id: string | null
  company_id: string | null
  created_at: string
  expires_at: string
  used_at: string | null
}

/** Details the customer fills in before the contract is rendered. */
export interface ContractForm {
  company_name: string
  representative_name: string
  email: string
  address?: string | undefined
}
