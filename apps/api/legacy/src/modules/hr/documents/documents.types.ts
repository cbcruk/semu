/** Code of a document category in the document box and the e-sign templates. */
export type DocumentCategoryCode = 'contract' | 'certificate' | 'consent' | 'resignation' | 'etc'

/** Where a stored employee document came from. */
export type DocumentSourceType = 'upload' | 'e_sign' | 'certificate'

/** A document category as listed by `settings/document-categories`. */
export interface DocumentCategory {
  id: number
  code: DocumentCategoryCode
  name: string
}

/** A row of `employee_documents` joined with its file metadata. */
export interface EmployeeDocumentRow {
  id: number
  company_id: string
  employee_id: number
  category: DocumentCategoryCode
  source_type: DocumentSourceType
  source_id: number | null
  file_id: string
  file_name: string
  created_by: string | null
  created_at: string
  mime_type: string
  size_bytes: number
}
