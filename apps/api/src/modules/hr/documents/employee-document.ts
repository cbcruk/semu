import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import {
  EmployeeDocumentId,
  EmployeeId,
  EsignRequestId,
  FileId,
  PayrollContractId,
  WorkContractId,
} from '../shared/hr-schemas.ts'
import type { EmployeeDocumentCategory, EmployeeDocumentLink } from './employee-document.types.ts'

/** 보관함에 올릴 수 있는 형식입니다. 서버가 내용(앞 바이트)으로 판정합니다. */
export const ARCHIVE_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const

/** 문서 보관함 카테고리입니다. */
export const EmployeeDocumentCategorySchema = Schema.Literals([
  'CONTRACT',
  'CERTIFICATE',
  'CONSENT',
  'RESIGNATION',
  'OTHER',
])

/** 문서 보관함 문서 응답입니다. 전자서명 완료본과 직접 올린 문서가 들어옵니다. */
export const EmployeeDocument = Schema.Struct({
  id: EmployeeDocumentId,
  employeeId: EmployeeId,
  category: EmployeeDocumentCategorySchema,
  /** 문서가 들어온 곳입니다. 전자서명 완료본(`ESIGN`)과 직접 올린 문서(`UPLOAD`)입니다. 증명서 발급(`CERTIFICATE`)은 아직 없습니다. */
  origin: Schema.Literals(['ESIGN', 'UPLOAD']),
  title: Schema.String,
  /** 문서 파일입니다. 본문은 `GET /employee-documents/{id}/file`로 내려받습니다. */
  fileId: FileId,
  /** 파일 이름과 형식입니다. 내려받을 때 그대로 씁니다. */
  fileName: Schema.String,
  contentType: Schema.String,
  /** 전자서명 완료본의 서명 요청입니다. */
  esignRequestId: Schema.optionalKey(EsignRequestId),
  /** 전자서명이 끝난 시각입니다. 전자서명 완료본에만 있습니다. */
  signedAt: Schema.optionalKey(Schema.String),
  /** 보관함에 들어온 시각입니다. 목록은 서명 시각(없으면 이 시각)이 늦은 것부터입니다. */
  createdAt: Schema.String,
  /** 서명 요청을 무효로 하면 `VOIDED`입니다. 문서는 남습니다. */
  status: Schema.Literals(['ACTIVE', 'VOIDED']),
  voidedAt: Schema.optionalKey(Schema.String),
  /** 이 문서가 확정한 계약입니다. 무효가 되어도 기록으로 남깁니다. */
  links: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal('WORK_CONTRACT'), id: WorkContractId }),
      Schema.Struct({ type: Schema.Literal('PAYROLL_CONTRACT'), id: PayrollContractId }),
    ]),
  ),
})

/** 문서 보관함 문서 응답의 타입입니다. */
export type EmployeeDocument = typeof EmployeeDocument.Type

/** 저장하는 보관함 문서입니다. */
export interface EmployeeDocumentRecord {
  id: Id<'document'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  category: EmployeeDocumentCategory
  origin: 'ESIGN' | 'UPLOAD'
  title: string
  fileId: Id<'file'>
  fileName: string
  contentType: string
  esignRequestId?: Id<'esignRequest'> | undefined
  signedAt?: string | undefined
  /** 직접 올린 사용자입니다. 전자서명 완료본은 없습니다. */
  createdBy?: Id<'user'> | undefined
  createdAt: string
  status: 'ACTIVE' | 'VOIDED'
  voidedAt?: string | undefined
  links: ReadonlyArray<EmployeeDocumentLink>
}

/** 문서 보관함 저장소입니다. 서명·발급에서 온 문서는 원본 보존을 위해 지우지 않고, 직접 올린 문서만 지웁니다. */
export class EmployeeDocumentRepository extends Context.Service<
  EmployeeDocumentRepository,
  {
    list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<EmployeeDocumentRecord>>
    find(companyId: Id<'company'>, id: Id<'document'>): Effect.Effect<Option.Option<EmployeeDocumentRecord>>
    findByEsignRequest(
      companyId: Id<'company'>,
      esignRequestId: Id<'esignRequest'>,
    ): Effect.Effect<Option.Option<EmployeeDocumentRecord>>
    save(record: EmployeeDocumentRecord): Effect.Effect<void>
    /** 직접 올린 문서만 지웁니다. 서명·발급 문서는 서비스가 막습니다. */
    remove(id: Id<'document'>): Effect.Effect<void>
    /**
     * 보관함에 넣기 전에 무효가 된 요청을 적어 둡니다. outbox 재전달로 완료가 무효보다 늦게 와도 무효로 넣기 위해서입니다.
     */
    markVoided(companyId: Id<'company'>, esignRequestId: Id<'esignRequest'>, at: string): Effect.Effect<void>
    /** {@link markVoided}로 적어 둔 무효 시각입니다. */
    voidedAt(companyId: Id<'company'>, esignRequestId: Id<'esignRequest'>): Effect.Effect<Option.Option<string>>
  }
>()('semu/hr/EmployeeDocumentRepository') {
  /** `hr_employee_documents` 표(무효 표식은 `hr_voided_esign_requests`)에 둡니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<EmployeeDocumentRecord> = []) =>
    Layer.effect(
      EmployeeDocumentRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<EmployeeDocumentRecord>('hr_employee_documents', {
          seed,
          companyOf: (record) => record.companyId,
        })
        const voids = yield* (yield* TableFactory).make<{
          id: Id<'esignRequest'>
          companyId: Id<'company'>
          voidedAt: string
        }>('hr_voided_esign_requests', { companyOf: (record) => record.companyId })
        return EmployeeDocumentRepository.of({
          list: (companyId) => table.byCompany(companyId),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((record) => record.companyId === companyId),
            ),
          findByEsignRequest: (companyId, esignRequestId) =>
            Effect.map(table.byCompany(companyId), (records) =>
              Option.fromNullishOr(records.find((record) => record.esignRequestId === esignRequestId)),
            ),
          save: (record) => table.put(record),
          remove: (id) => table.remove(id),
          markVoided: (companyId, esignRequestId, at) => voids.put({ id: esignRequestId, companyId, voidedAt: at }),
          voidedAt: (companyId, esignRequestId) =>
            Effect.map(
              voids.get(esignRequestId),
              Option.flatMap((record) =>
                record.companyId === companyId ? Option.some(record.voidedAt) : Option.none(),
              ),
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EmployeeDocumentRecord> = []) =>
    EmployeeDocumentRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 문서가 없거나 다른 회사의 문서입니다. */
export class EmployeeDocumentNotFound extends HttpApiError.Problem<EmployeeDocumentNotFound>()(
  'EmployeeDocumentNotFound',
  { type: problemType('EMPLOYEE_DOCUMENT_NOT_FOUND'), status: 404, title: 'Employee document not found' },
  { code: Schema.tag('EMPLOYEE_DOCUMENT_NOT_FOUND') },
) {}

/** 전자서명·발급에서 온 문서는 원본 보존을 위해 지울 수 없습니다. 직접 올린 문서만 지웁니다. */
export class DocumentLocked extends HttpApiError.Problem<DocumentLocked>()(
  'DocumentLocked',
  { type: problemType('DOCUMENT_LOCKED'), status: 409, title: 'Signed or issued documents cannot be deleted' },
  { code: Schema.tag('DOCUMENT_LOCKED'), origin: Schema.Literals(['ESIGN', 'UPLOAD']) },
) {}

/** 보관함에 올릴 수 없는 파일입니다. 형식은 내용(앞 바이트)으로 판정하고, 받는 형식은 PDF·PNG·JPEG입니다. */
export class DocumentFileTypeNotAllowed extends HttpApiError.Problem<DocumentFileTypeNotAllowed>()(
  'DocumentFileTypeNotAllowed',
  { type: problemType('FILE_TYPE_NOT_ALLOWED'), status: 415, title: 'File type is not allowed' },
  { code: Schema.tag('FILE_TYPE_NOT_ALLOWED'), allowedContentTypes: Schema.Array(Schema.String) },
) {}

/** 파일이 크기 한도를 넘거나 비어 있습니다. */
export class DocumentFileSizeInvalid extends HttpApiError.Problem<DocumentFileSizeInvalid>()(
  'DocumentFileSizeInvalid',
  { type: problemType('FILE_SIZE_INVALID'), status: 413, title: 'File is empty or too large' },
  { code: Schema.tag('FILE_SIZE_INVALID'), maxBytes: Schema.Number },
) {}

/** 보관함 문서의 파일 본문이 저장소에 없습니다. 저장소가 깨졌을 때만 생깁니다. */
export class DocumentFileMissing extends HttpApiError.Problem<DocumentFileMissing>()(
  'DocumentFileMissing',
  { type: problemType('DOCUMENT_FILE_MISSING'), status: 404, title: 'Document file is missing' },
  { code: Schema.tag('DOCUMENT_FILE_MISSING') },
) {}
