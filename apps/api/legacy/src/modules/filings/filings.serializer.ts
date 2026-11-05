import type { PlainDate } from '../../lib/plain-date.types'
import { PRE_FILING_STATUSES } from './filing-status'
import type { DocumentRow, EventRow, FileRow, FilingRow, RequirementRow } from './filings.types'
import { datePart, isDocumentVisibleToClient } from './filings.utils'
import { processStepOf } from './process-step'

type DocumentWithFile = DocumentRow & { original_name: string; mime_type: string; size_bytes: number }

/** Checks whether a filing is past its deadline without having been filed. */
export function isOverdue(filing: FilingRow, today: PlainDate): boolean {
  const deadline = filing.due_date ?? filing.payment_due
  return deadline !== null && deadline < today && PRE_FILING_STATUSES.includes(filing.status)
}

/**
 * Serializes a filing for list responses.
 *
 * VAT filings also carry the legacy `/tax/surtax/` fields (`payment_deadline`,
 * `purchase_sales_ledger_*`, `payment_slip_sent`, `amount`, `process_step`)
 * so the legacy report app can read this API unchanged.
 */
export function serializeFiling(filing: FilingRow, today: PlainDate): Record<string, unknown> {
  const step = processStepOf(filing.tax_type, filing.status)
  const body: Record<string, unknown> = {
    id: filing.id,
    tax_type: filing.tax_type,
    kind: filing.kind,
    tax_period_key: filing.tax_period_key,
    revision: filing.revision,
    year: filing.year,
    quarter: filing.quarter,
    period_start: filing.period_start,
    period_end: filing.period_end,
    statutory_due: filing.statutory_due,
    due_date: filing.due_date,
    payment_due: filing.payment_due,
    submit_due: filing.submit_due,
    status: filing.status,
    is_overdue: isOverdue(filing, today),
    step: step.step,
    step_index: step.index,
    step_count: step.count,
    payable_amount: filing.payable_amount,
    settlement: filing.settlement,
    paid_on: filing.paid_on,
    ledger_dispute_count: filing.ledger_dispute_count,
    version: filing.version,
    updated_at: filing.updated_at,
  }
  if (filing.tax_type === 'surtax') {
    Object.assign(body, {
      company: filing.company_id,
      payment_deadline: filing.payment_due,
      purchase_sales_ledger_upload_completed: datePart(filing.ledger_uploaded_at),
      purchase_sales_ledger_confirm_completed: datePart(filing.ledger_confirmed_at),
      payment_slip_sent: datePart(filing.payment_slip_sent_at),
      amount: filing.payable_amount,
      process_step: step.step,
    })
  }
  return body
}

/** Serializes a filing with its checklist, files, visible documents and timeline. */
export function serializeFilingDetail(
  filing: FilingRow,
  requirements: readonly RequirementRow[],
  files: readonly (FileRow & { code: string })[],
  documents: readonly DocumentWithFile[],
  events: readonly EventRow[],
  viewer: 'client' | 'agency',
  today: PlainDate,
): Record<string, unknown> {
  const visibleDocuments =
    viewer === 'agency'
      ? documents
      : documents.filter((doc) => doc.replaced_at === null && isDocumentVisibleToClient(doc.doc_type, filing.status))
  return {
    ...serializeFiling(filing, today),
    requirements: requirements.map((requirement) => ({
      code: requirement.code,
      label: requirement.label,
      response: requirement.response,
      auto_linked: requirement.auto_linked === 1,
      linked_status: requirement.auto_linked === 1 ? (requirement.response === 'provided' ? 'closed' : 'open') : null,
      note: requirement.note,
      updated_at: requirement.updated_at,
      files: files.filter((file) => file.code === requirement.code).map(serializeFile),
    })),
    documents: visibleDocuments.map((doc) => ({
      id: doc.id,
      doc_type: doc.doc_type,
      original_name: doc.original_name,
      mime_type: doc.mime_type,
      size_bytes: doc.size_bytes,
      created_at: doc.created_at,
      first_viewed_at: doc.first_viewed_at,
      replaced_at: doc.replaced_at,
    })),
    timeline: events.map((event) => ({
      type: event.type,
      actor_type: event.actor_type,
      from_status: event.from_status,
      to_status: event.to_status,
      payload: event.payload === null ? null : (JSON.parse(event.payload) as unknown),
      created_at: event.created_at,
    })),
  }
}

function serializeFile(file: FileRow): Record<string, unknown> {
  return {
    id: file.id,
    original_name: file.original_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    created_at: file.created_at,
  }
}
