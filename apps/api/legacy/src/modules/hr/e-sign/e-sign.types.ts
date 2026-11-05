import type { DocumentCategoryCode } from '../documents/documents.types'
import type { EmploymentType } from '../shared/hr.types'

/** Status of an e-sign request (`E_SIGN_REQUEST_STATUS`). */
export type ESignRequestStatus = 'draft' | 'pending' | 'in_progress' | 'completed' | 'voided' | 'expired' | 'cancelled' | 'send_failed'

/** Whether a template is the product's base template or the company's edited copy. */
export type TemplateType = 'e_sign_template' | 'company_e_sign_template'

/** What a template produces, which decides the follow-up effects of signing. */
export type DocumentKind =
  | 'employment_contract'
  | 'daily_employment_contract'
  | 'part_time_employment_contract'
  | 'annual_salary_contract'
  | 'service_contract'
  | 'privacy_consent'
  | 'nda'
  | 'resignation'
  | 'employment_certificate'
  | 'career_certificate'
  | 'retirement_certificate'
  | 'work_rules'

/** Input type of a template field. */
export type TemplateFieldType = 'text' | 'textarea' | 'date' | 'number' | 'money' | 'select'

/** An input slot in a template body. */
export interface TemplateField {
  key: string
  label: string
  type: TemplateFieldType
  required: boolean
  default: string | number | null
  /** Whether the clause holding the field can be hidden ([표시/숨김]). */
  visible_toggle: boolean
  /** Employee attribute the field is prefilled from, such as `employee.join_date`. */
  source: string | null
  /** Whether the worker fills the field while signing rather than the administrator. */
  signer: boolean
}

/** A block of template body text; `{{key}}` placeholders refer to fields. */
export interface TemplateBlock {
  type: 'heading' | 'paragraph' | 'clause'
  text: string
}

/** A base template shipped with the product. */
export interface BaseTemplate {
  id: number
  category: DocumentCategoryCode
  title: string
  document_kind: DocumentKind
  contract_type: 'regular' | 'contract' | null
  workplace_size: 'gte5' | 'lt5' | null
  target_employment_type: EmploymentType
  is_certificate: boolean
  body: TemplateBlock[]
  fields: TemplateField[]
}

/** A row of `esign_template_overrides`. */
export interface TemplateOverrideRow {
  company_id: string
  template_id: number
  title: string | null
  body: string | null
  field_defaults: string | null
  is_active: 0 | 1
  default_seal_id: number | null
  updated_by: string | null
  updated_at: string
}

/** A base template merged with the company's override. */
export interface ResolvedTemplate extends BaseTemplate {
  template_type: TemplateType
  is_active: boolean
  default_seal_id: number | null
  updated_by: string | null
  updated_at: string | null
}

/** A row of `esign_company_seals`, joined with the creator's email. */
export interface CompanySealRow {
  id: number
  company_id: string
  file_id: string
  source: 'upload' | 'drawn'
  created_by: string
  created_at: string
  deleted_at: string | null
  created_by_email: string | null
}

/** A row of `esign_noti_recipients`, joined with the position name. */
export interface NotiRecipientRow {
  id: number
  company_id: string
  sort_order: number
  name: string
  position_id: number | null
  phone: string
  email: string | null
  position_name: string | null
}

/** A notification recipient as written by the settings modal. */
export interface NotiRecipientInput {
  name: string
  position: number | null
  phone: string
  email: string | null
}

/** A row of `esign_requests`. */
export interface ESignRequestRow {
  id: number
  company_id: string
  status: ESignRequestStatus
  version: number
  workplace_size: 'gte5' | 'lt5' | null
  wage_type: 'monthly' | 'daily' | 'hourly' | null
  work_condition_id: number | null
  work_schedule_policy_id: number | null
  field_values: string
  company_seal_id: number | null
  company_seal_file_id: string | null
  due_date: string | null
  token_hash: string | null
  verify_failures: number
  send_error: string | null
  sent_at: string | null
  verified_at: string | null
  signed_at: string | null
  expired_at: string | null
  cancelled_at: string | null
  voided_at: string | null
  result_file_id: string | null
  signer_input: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** A row of `esign_request_documents`. */
export interface ESignDocumentRow {
  company_id: string
  request_id: number
  doc_index: number
  template_id: number
  template_type: TemplateType
  title: string
  document_kind: DocumentKind
  category: DocumentCategoryCode
}

/** A row of `esign_recipients`. */
export interface ESignRecipientRow {
  company_id: string
  request_id: number
  employment_type: EmploymentType | null
  employee_id: number | null
  name: string
  email: string | null
  phone: string | null
  is_local: 0 | 1
  nationality: string | null
  visa: string | null
  birth_date: string | null
}

/** A request with its documents and recipient. */
export interface ESignRequestAggregate {
  request: ESignRequestRow
  documents: ESignDocumentRow[]
  recipient: ESignRecipientRow
}

/** Columns of a request an administrator edits while it is a draft. */
export interface ESignDraftValues {
  workplace_size: 'gte5' | 'lt5' | null
  wage_type: 'monthly' | 'daily' | 'hourly' | null
  work_condition_id: number | null
  work_schedule_policy_id: number | null
  field_values: string
  company_seal_id: number | null
  due_date: string | null
}

/** Filters of the e-sign request list. */
export interface ESignListFilter {
  dateType: 'requested_at' | 'signed_at'
  startDate: string | null
  endDate: string | null
  statuses: ESignRequestStatus[]
  category: string | null
  employeeName: string | null
  search: string | null
}

/** Field values per document index, as `{ "0": { key: value, __hidden: [...] } }`. */
export type FieldValueMap = Record<string, Record<string, unknown>>

/** Network details recorded in the audit trail. */
export interface RequestOrigin {
  ip: string | null
  userAgent: string | null
}

/** What the worker submits when completing a signature. */
export interface CompleteInput {
  documents: { index: number; field_values?: Record<string, unknown> | undefined; seal_id: number }[]
  leaving_reason?: string | undefined
  leaving_detail_reason?: string | undefined
  agreed_at?: string | undefined
}
