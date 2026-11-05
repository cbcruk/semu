import type { EmploymentType } from '../shared/hr.types'

/** Status of an issued certificate (`CERTIFICATE_ISSUANCE_STATUS`). */
export type CertificateStatus = 'issued' | 'sending' | 'sent' | 'send_failed'

/** A row of `certificate_issuances`. */
export interface CertificateRow {
  id: number
  company_id: string
  status: CertificateStatus
  version: number
  template_id: number
  title: string
  employment_type: EmploymentType
  employee_id: number
  employee_name: string
  field_values: string
  company_seal_id: number | null
  issue_number: string
  issued_at: string
  file_id: string
  sent_to_email: string | null
  sent_to_phone: string | null
  sent_at: string | null
  send_error: string | null
  token_hash: string | null
  token_expires_at: string | null
  verify_failures: number
  created_by: string
  created_at: string
  updated_at: string
}

/** Values of a new certificate row. */
export type CertificateInsert = Omit<CertificateRow, 'id' | 'status' | 'version' | 'sent_to_email' | 'sent_to_phone' | 'sent_at' | 'send_error' | 'token_hash' | 'token_expires_at' | 'verify_failures' | 'updated_at'>

/** Filters of the certificate list. */
export interface CertificateFilter {
  statuses: CertificateStatus[]
  search: string | null
  employeeId: number | null
}

/** Body of a certificate issuance. */
export interface IssueCertificateInput {
  template: number
  employment_type: EmploymentType
  employee_id: number
  field_values?: Record<string, unknown> | undefined
  company_seal?: number | null | undefined
}
