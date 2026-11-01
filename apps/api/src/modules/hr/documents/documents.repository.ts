import type { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, queryOne, type SqlValue } from '../../../db/query'
import type { DocumentCategory, DocumentCategoryCode, DocumentSourceType, EmployeeDocumentRow } from './documents.types'

/** Document categories shared by the document box, e-sign templates and certificates. Names are product labels. */
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  { id: 1, code: 'contract', name: '계약서' },
  { id: 2, code: 'certificate', name: '증명서' },
  { id: 3, code: 'consent', name: '동의서' },
  { id: 4, code: 'resignation', name: '사직서' },
  { id: 5, code: 'etc', name: '기타' },
]

const DOCUMENT_SELECT = `SELECT d.*, f.mime_type, f.size_bytes FROM employee_documents d
  JOIN files f ON f.company_id = d.company_id AND f.id = d.file_id`

/** Resolves a category given as its code or numeric ID. */
export function resolveDocumentCategory(value: string): DocumentCategory | undefined {
  return DOCUMENT_CATEGORIES.find((category) => category.code === value || String(category.id) === value)
}

/** Lists a page of an employee's documents, newest first, optionally in one category. */
export function listEmployeeDocuments(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  category: DocumentCategoryCode | null,
  limit: number,
  offset: number,
): { rows: EmployeeDocumentRow[]; count: number } {
  const where = category === null ? 'd.company_id = ? AND d.employee_id = ?' : 'd.company_id = ? AND d.employee_id = ? AND d.category = ?'
  const params: SqlValue[] = category === null ? [companyId, employeeId] : [companyId, employeeId, category]
  const rows = queryAll<EmployeeDocumentRow>(db, `${DOCUMENT_SELECT} WHERE ${where} ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM employee_documents d WHERE ${where}`, params)
  return { rows, count: total?.n ?? 0 }
}

/** Finds one document of an employee. */
export function findEmployeeDocument(db: DatabaseSync, companyId: string, employeeId: number, documentId: number): EmployeeDocumentRow | undefined {
  return queryOne<EmployeeDocumentRow>(db, `${DOCUMENT_SELECT} WHERE d.company_id = ? AND d.employee_id = ? AND d.id = ?`, [companyId, employeeId, documentId])
}

/**
 * Files a stored file in an employee's document box and returns the document ID.
 *
 * E-sign completion and certificate issuance call this with their own source type and ID.
 */
export function insertEmployeeDocument(
  db: DatabaseSync,
  values: {
    companyId: string
    employeeId: number
    category: DocumentCategoryCode
    sourceType: DocumentSourceType
    sourceId: number | null
    fileId: string
    fileName: string
    createdBy: string | null
    now: string
  },
): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO employee_documents (company_id, employee_id, category, source_type, source_id, file_id, file_name, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [values.companyId, values.employeeId, values.category, values.sourceType, values.sourceId, values.fileId, values.fileName, values.createdBy, values.now],
  )
  if (row === undefined) throw new Error('Document insert returned no row.')
  return row.id
}

/** Deletes a document entry; the file row stays for other references. */
export function deleteEmployeeDocument(db: DatabaseSync, companyId: string, employeeId: number, documentId: number): boolean {
  execute(db, 'UPDATE employee_work_contracts SET document_id = NULL WHERE company_id = ? AND employee_id = ? AND document_id = ?', [
    companyId,
    employeeId,
    documentId,
  ])
  return execute(db, 'DELETE FROM employee_documents WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, documentId]) > 0
}
