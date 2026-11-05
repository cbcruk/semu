/** Registration status of a business as reported by the NTS lookup. */
export type BusinessStatus = 'registered' | 'suspended' | 'closed' | 'unknown'

/** Answer of the NTS business status lookup, in wire shape. */
export interface BusinessStatusResult {
  business_status: BusinessStatus
  taxation_type: string | null
  closed_on: string | null
}

/** A row of `partners`. */
export interface PartnerRow {
  id: string
  company_id: string
  partner_type: 'business' | 'individual'
  business_entity_type: 'corporation' | 'individual' | null
  name: string
  representative_name: string
  business_number: string | null
  business_status: BusinessStatus | null
  is_sales: 0 | 1
  is_purchase: 0 | 1
  business_type: string | null
  business_class: string | null
  address: string | null
  phone_number: string | null
  memo: string | null
  representative_image_path: string | null
  primary_account_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** A row of `partner_bank_accounts`. */
export interface PartnerBankAccountRow {
  id: string
  partner_id: string
  bank_code: string
  account_number_enc: string
  account_number_tail: string
  account_name: string | null
  bankbook_image_path: string | null
  seq: number
}

/** A row of `partner_contacts`. */
export interface PartnerContactRow {
  id: string
  partner_id: string
  name: string
  department: string | null
  email: string | null
  phone_number: string | null
  mobile_number: string | null
  fax_number: string | null
  seq: number
}

/** Unsettled amounts of a partner, computed from evidence and settlement links. */
export interface UnsettledAmounts {
  unsettled_sales_amount: number
  unsettled_purchase_amount: number
}
