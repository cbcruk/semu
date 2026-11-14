import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeDocumentId, EmployeeId } from '../shared/hr-schemas.ts'
import { EmployeeDocument, EmployeeDocumentCategorySchema, EmployeeDocumentNotFound } from './employee-document.ts'

/**
 * 직원 문서 보관함입니다. 전자서명이 완료되면 완료본이 들어오고, 무효로 하면 `VOIDED`가 됩니다.
 *
 * 직접 올리기와 파일 내려받기는 파일 저장소가 생기면 붙입니다.
 */
export class EmployeeDocumentsApi extends HttpApiGroup.make('hrEmployeeDocuments')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/documents', {
      params: { id: EmployeeId },
      query: { category: Schema.optionalKey(EmployeeDocumentCategorySchema) },
      success: Schema.Struct({ items: Schema.Array(EmployeeDocument) }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.get('get', '/employee-documents/:documentId', {
      params: { documentId: EmployeeDocumentId },
      success: EmployeeDocument,
      error: [...ACCESS_ERRORS, EmployeeDocumentNotFound],
    }),
  )
  .middleware(Authentication) {}
