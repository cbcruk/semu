import type { IntegrationAuthType, IntegrationType } from '../adapters/scraping.adapter'

/** Integration states: active ↔ error, and deleted once removed. */
export type IntegrationStatus = 'active' | 'inactive' | 'error' | 'deleted'

/** A row of `integrations`. */
export interface IntegrationRow {
  id: string
  company_id: string
  type: IntegrationType
  sub_code: string | null
  auth_type: IntegrationAuthType
  is_corporate: 0 | 1
  certificate_id: string | null
  account_id: string | null
  status: IntegrationStatus
  created_at: string
  modified_at: string
  deleted_at: string | null
}

/** Kinds of items an integration exposes. */
export type ItemKind = 'card' | 'account' | 'store' | 'scm'

/** A row of `integration_items`: a card, bank account, store or SCM. */
export interface ItemRow {
  id: string
  company_id: string
  integration_id: string
  kind: ItemKind
  external_key: string
  name: string
  number_enc: string | null
  masked_number: string | null
  account_type: string | null
  currency_code: string | null
  holder: string | null
  open_date: string | null
  balance: number | null
  is_active: 0 | 1
  is_visible_on_cash_report: 0 | 1
  is_scrap_available: 0 | 1
  created_at: string
  modified_at: string
  deleted_at: string | null
}

/** Secrets kept in `integration_credentials`, encrypted as one JSON document. */
export interface StoredCredential {
  password?: string
  keys?: Record<string, string>
}

/** Certificate usages (범용, 은행·카드·보험용, 전자세금용). */
export type CertUsage = 'general' | 'bank' | 'etax'

/** A row of `certificates`. */
export interface CertificateRow {
  id: string
  company_id: string
  cert_name: string
  subject_dn: string
  oid: string
  cert_type: 'personal' | 'business'
  usage: CertUsage
  organization_code: string
  serial: string
  pub_date: string
  end_date: string
  owner_name: string
  owner_business_number: string | null
  status: 'ACTIVE' | 'INACTIVE'
  cert_blob_enc: string
  key_blob_enc: string
  sign_pw_enc: string
  registered_by: string
  created_at: string
  modified_at: string
  deleted_at: string | null
}

/** Certificate state reported to the client; `UNREGISTERED` means the linked certificate was deleted. */
export type CertificateStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | 'UNREGISTERED'

/** A row of `scrap_requests`. */
export interface ScrapRequestRow {
  id: string
  company_id: string
  service: IntegrationType
  status: 'request' | 'done' | 'timeout'
  requested_at: string
  finished_at: string | null
  group_id: string | null
  requester: 'user' | 'system'
  requested_by: string | null
  integration_id: string | null
  item_id: string | null
  options: string | null
  code: string | null
  message: string | null
  is_initial: 0 | 1
  next_available_at: string | null
  timeout_at: string | null
}

/** A row of `scrap_results`, the source of `last_scrap_status`. */
export interface ScrapResultRow {
  id: string
  company_id: string
  request_id: string | null
  service: IntegrationType
  integration_id: string
  item_id: string | null
  status: 'success' | 'fail' | 'progress'
  code: string | null
  message: string | null
  message_content: string | null
  is_initial: 0 | 1
  is_retryable: 0 | 1
  record_count: number
  created_at: string
}

/** Credentials sent with a registration: ID/PW or a registered certificate and its signing password. */
export interface AuthInput {
  account_id?: string | undefined
  account_pw?: string | undefined
  cert_id?: string | undefined
  sign_pw?: string | undefined
}
