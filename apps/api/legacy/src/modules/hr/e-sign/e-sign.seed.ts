import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../../db/seed.types'
import { findEmployeeRow } from '../employees/employees.repository'
import { toEmploymentType } from '../shared/hr.utils'
import { findBaseTemplate, REGULAR_EMPLOYMENT_CONTRACT_TEMPLATE_ID } from './base-templates'
import { insertDraft, replaceDocuments, saveRecipient } from './e-sign-requests.repository'

/** Inserts one draft employment contract for a demo employee; drafts need no stored files. */
export function seedESignDemo(db: DatabaseSync, context: SeedContext, ids: { companyId: string; userId: string; employeeId: number }): void {
  const template = findBaseTemplate(REGULAR_EMPLOYMENT_CONTRACT_TEMPLATE_ID)
  const employee = findEmployeeRow(db, ids.companyId, ids.employeeId)
  if (template === undefined || employee === undefined) return
  const fieldValues = {
    '0': {
      join_date: employee.join_date,
      contract_start_date: employee.join_date,
      job_description: '서비스 기획',
      weekly_work_hours: 40,
      monthly_wage: 3_200_000,
      monthly_work_hours: 209,
    },
  }
  const requestId = insertDraft(
    db,
    ids.companyId,
    {
      workplace_size: 'gte5',
      wage_type: 'monthly',
      work_condition_id: null,
      work_schedule_policy_id: null,
      field_values: JSON.stringify(fieldValues),
      company_seal_id: null,
      due_date: null,
    },
    ids.userId,
    context.now,
  )
  replaceDocuments(db, ids.companyId, requestId, [
    { doc_index: 0, template_id: template.id, template_type: 'e_sign_template', title: template.title, document_kind: template.document_kind, category: template.category },
  ])
  saveRecipient(db, {
    company_id: ids.companyId,
    request_id: requestId,
    employment_type: toEmploymentType(employee.kind),
    employee_id: employee.id,
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    is_local: employee.is_local,
    nationality: employee.nationality,
    visa: employee.visa,
    birth_date: employee.birth_date,
  })
}
