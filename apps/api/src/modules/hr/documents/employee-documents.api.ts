import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AccessReasonHeaders } from '../../../shared/personal-data/access-reason.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeDocumentId, EmployeeId } from '../shared/hr-schemas.ts'
import {
  ARCHIVE_CONTENT_TYPES,
  DocumentFileMissing,
  DocumentFileSizeInvalid,
  DocumentFileTypeNotAllowed,
  DocumentLocked,
  EmployeeDocument,
  EmployeeDocumentCategorySchema,
  EmployeeDocumentNotFound,
} from './employee-document.ts'

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))

/**
 * 올리는 파일 본문입니다. 받는 형식마다 하나씩 두어 다른 `Content-Type`은 계약 단계에서 415로 거절됩니다. 그래도 형식은
 * 서버가 내용으로 다시 판정합니다(`FILE_TYPE_NOT_ALLOWED`).
 */
const UploadBody = ARCHIVE_CONTENT_TYPES.map((contentType) =>
  Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType })),
)

/**
 * 내려받는 파일 본문입니다. 실제 형식은 `Content-Type` 헤더로 문서마다 정하고, 파일 이름은 `Content-Disposition`에 담습니다.
 */
const DocumentContent = HttpApiSchema.WithHeaders(
  Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: 'application/octet-stream' })),
  { 'content-type': Schema.String, 'content-disposition': Schema.String },
)

/**
 * 직원 문서 보관함입니다. 전자서명이 완료되면 완료본이 들어오고, 무효로 하면 `VOIDED`가 됩니다. 그 밖의 문서는 직접 올립니다.
 *
 * 파일은 공통 파일 저장소에 두고(D7), 이 그룹의 권한으로만 내려받습니다. 파일 ID만으로는 내려받을 수 없습니다.
 */
export class EmployeeDocumentsApi extends HttpApiGroup.make('hrEmployeeDocuments')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/documents', {
      params: { id: EmployeeId },
      query: { category: Schema.optionalKey(EmployeeDocumentCategorySchema) },
      success: Schema.Struct({ items: Schema.Array(EmployeeDocument) }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('upload', '/employees/:id/documents', {
      params: { id: EmployeeId },
      query: { title: Name, category: EmployeeDocumentCategorySchema, fileName: Name },
      payload: UploadBody,
      success: EmployeeDocument.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeNotFound, DocumentFileTypeNotAllowed, DocumentFileSizeInvalid],
    }),
    HttpApiEndpoint.get('get', '/employee-documents/:documentId', {
      params: { documentId: EmployeeDocumentId },
      success: EmployeeDocument,
      error: [...ACCESS_ERRORS, EmployeeDocumentNotFound],
    }),
    HttpApiEndpoint.get('content', '/employee-documents/:documentId/file', {
      params: { documentId: EmployeeDocumentId },
      headers: AccessReasonHeaders,
      success: DocumentContent,
      error: [...ACCESS_ERRORS, EmployeeDocumentNotFound, DocumentFileMissing],
    }),
    HttpApiEndpoint.delete('remove', '/employee-documents/:documentId', {
      params: { documentId: EmployeeDocumentId },
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, EmployeeDocumentNotFound, DocumentLocked],
    }),
  )
  .middleware(Authentication) {}
