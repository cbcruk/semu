import { DOCUMENT_CATEGORIES } from '../documents/documents.repository'
import type { DocumentCategoryCode } from '../documents/documents.types'
import type { CompanySealRow, ESignRequestAggregate, NotiRecipientRow, ResolvedTemplate } from './e-sign.types'

/** Serializes a document category reference. */
export function serializeCategory(code: DocumentCategoryCode): { id: number; code: string; name: string } {
  const category = DOCUMENT_CATEGORIES.find((candidate) => candidate.code === code) ?? { id: 0, code, name: code }
  return { id: category.id, code: category.code, name: category.name }
}

/** Serializes a template for list rows; `detail` adds the body and fields. */
export function serializeTemplate(template: ResolvedTemplate, detail: boolean): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: template.id,
    template_type: template.template_type,
    base_template: template.template_type === 'company_e_sign_template' ? template.id : null,
    category: serializeCategory(template.category),
    title: template.title,
    document_kind: template.document_kind,
    contract_type: template.contract_type,
    workplace_size: template.workplace_size,
    target_employment_type: template.target_employment_type,
    is_active: template.is_active,
    is_certificate: template.is_certificate,
    default_seal: template.default_seal_id,
    updated_by: template.updated_by,
    updated: template.updated_at,
  }
  return detail ? { ...summary, body: template.body, fields: template.fields } : summary
}

/** Serializes a company seal with the API path of its image. */
export function serializeSeal(seal: CompanySealRow): Record<string, unknown> {
  return {
    id: seal.id,
    image: `/api/company/${seal.company_id}/employment/settings/company-seals/${seal.id}/image`,
    source: seal.source,
    created_by: seal.created_by_email,
    created: seal.created_at,
  }
}

/** Serializes a notification recipient. */
export function serializeNotiRecipient(row: NotiRecipientRow): Record<string, unknown> {
  return { id: row.id, name: row.name, position: row.position_id, position_name: row.position_name, phone: row.phone, email: row.email }
}

/** Serializes an e-sign request for the administrator's list and detail screens. */
export function serializeRequest(aggregate: ESignRequestAggregate, extras: { departmentName: string | null; createdByEmail: string | null }): Record<string, unknown> {
  const { request, documents, recipient } = aggregate
  const first = documents[0]
  return {
    id: request.id,
    status: request.status,
    version: request.version,
    title: first?.title ?? null,
    category: first === undefined ? null : serializeCategory(first.category),
    templates: documents.map((document) => ({
      index: document.doc_index,
      template_type: document.template_type,
      template_id: document.template_id,
      title: document.title,
      document_kind: document.document_kind,
      category: document.category,
    })),
    workplace_size: request.workplace_size,
    recipient: {
      employment_type: recipient.employment_type,
      employee_id: recipient.employee_id,
      is_new: recipient.employee_id === null,
      name: recipient.name,
      email: recipient.email,
      phone: recipient.phone,
      is_local: recipient.is_local === 1,
      nationality: recipient.nationality,
      visa: recipient.visa,
      birth_date: recipient.birth_date,
      department_name: extras.departmentName,
    },
    wage_type: request.wage_type,
    work_condition: request.work_condition_id,
    work_schedule_policy: request.work_schedule_policy_id,
    field_values: JSON.parse(request.field_values) as unknown,
    company_seal: request.company_seal_id,
    due_date: request.due_date,
    sent_at: request.sent_at,
    signed_at: request.signed_at,
    expired_at: request.expired_at,
    cancelled_at: request.cancelled_at,
    voided_at: request.voided_at,
    send_error: request.send_error,
    has_result_file: request.result_file_id !== null,
    created_by: extras.createdByEmail,
    created: request.created_at,
    updated: request.updated_at,
  }
}
