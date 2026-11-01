import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { invalidField, notFound } from '../../../lib/domain-error'
import { fileResponse } from '../../../lib/http'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { parseId, requireEmployee } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { commitHrFile, DOCUMENT_MIME_TYPES, prepareHrFile, readHrFile, readHrUpload } from '../shared/hr-files'
import { deleteEmployeeDocument, DOCUMENT_CATEGORIES, findEmployeeDocument, insertEmployeeDocument, listEmployeeDocuments, resolveDocumentCategory } from './documents.repository'
import type { EmployeeDocumentRow } from './documents.types'

const LIST = '/employment/wage-employees/:employeeId{[0-9]+}/documents'
const ONE = `${LIST}/:documentId{[0-9]+}`
const listQuery = z.object({ category: z.string().optional(), limit: z.string().optional(), offset: z.string().optional() })

/** Routes of an employee's document box: list, upload, metadata, download and delete. */
export function documentRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const load = (companyId: string, employeeId: number, documentIdParam: string | undefined): EmployeeDocumentRow => {
    const document = findEmployeeDocument(deps.db, companyId, employeeId, parseId(documentIdParam, 'Document'))
    if (document === undefined) throw notFound('Document')
    return document
  }

  return new Hono<AppEnv>()
    .get(LIST, menu, zValidator('query', listQuery, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const query = c.req.valid('query')
      const category = query.category === undefined || query.category === '' ? null : resolveDocumentCategory(query.category)
      if (category === undefined) throw invalidField('category', 'Unknown document category.')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listEmployeeDocuments(deps.db, c.var.company.id, employee.id, category?.code ?? null, page.limit, page.offset)
      return c.json(toPage(rows.map(serializeDocument), count, page, c.req.url))
    })
    .post(LIST, menu, async (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const upload = await readHrUpload(c)
      const category = resolveDocumentCategory(upload.fields['category'] ?? '')
      if (category === undefined) throw invalidField('category', 'Choose a document category.')
      const prepared = await prepareHrFile(deps, employee.company_id, upload, c.var.user.id, DOCUMENT_MIME_TYPES)
      const documentId = await commitHrFile(deps, prepared, (file) =>
        insertEmployeeDocument(deps.db, {
          companyId: employee.company_id,
          employeeId: employee.id,
          category: category.code,
          sourceType: 'upload',
          sourceId: null,
          fileId: file.id,
          fileName: upload.name,
          createdBy: c.var.user.id,
          now: deps.clock.now(),
        }),
      )
      return c.json(serializeDocument(load(employee.company_id, employee.id, String(documentId))), 201)
    })
    .get(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(serializeDocument(load(employee.company_id, employee.id, c.req.param('documentId'))))
    })
    .get(`${ONE}/download`, menu, async (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const document = load(employee.company_id, employee.id, c.req.param('documentId'))
      const { file, data } = await readHrFile(deps, employee.company_id, document.file_id)
      return fileResponse(c, { original_name: document.file_name, mime_type: file.mime_type }, data)
    })
    .delete(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const document = load(employee.company_id, employee.id, c.req.param('documentId'))
      deleteEmployeeDocument(deps.db, employee.company_id, employee.id, document.id)
      return c.body(null, 204)
    })
}

function serializeDocument(row: EmployeeDocumentRow): Record<string, unknown> {
  const category = DOCUMENT_CATEGORIES.find((candidate) => candidate.code === row.category)
  return {
    id: row.id,
    employee: row.employee_id,
    category: category === undefined ? null : { id: category.id, code: category.code, name: category.name },
    source_type: row.source_type,
    source_id: row.source_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size: row.size_bytes,
    created: row.created_at,
    created_by: row.created_by,
  }
}
