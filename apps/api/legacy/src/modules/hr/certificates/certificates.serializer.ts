import { parseJson } from '../shared/hr.utils'
import type { CertificateRow } from './certificates.types'

/** Serializes a certificate for the company screens; the link token is never exposed. */
export function serializeCertificate(certificate: CertificateRow): Record<string, unknown> {
  return {
    id: certificate.id,
    status: certificate.status,
    version: certificate.version,
    template: certificate.template_id,
    title: certificate.title,
    employment_type: certificate.employment_type,
    employee_id: certificate.employee_id,
    employee_name: certificate.employee_name,
    field_values: parseJson<Record<string, unknown>>(certificate.field_values, {}),
    company_seal: certificate.company_seal_id,
    issue_number: certificate.issue_number,
    issued_at: certificate.issued_at,
    sent_to_email: certificate.sent_to_email,
    sent_to_phone: certificate.sent_to_phone,
    sent_at: certificate.sent_at,
    send_error: certificate.send_error,
    link_expires_at: certificate.token_expires_at,
    file: `/api/company/${certificate.company_id}/employment/certificates/${certificate.id}/file`,
    created: certificate.created_at,
    updated: certificate.updated_at,
  }
}
