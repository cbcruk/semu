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

/** 문서 보관함 카테고리입니다. */
export const EmployeeDocumentCategorySchema = Schema.Literals([
  'CONTRACT',
  'CERTIFICATE',
  'CONSENT',
  'RESIGNATION',
  'OTHER',
])

/** 문서 보관함 문서 응답입니다. 지금은 전자서명 완료본만 들어옵니다. */
export const EmployeeDocument = Schema.Struct({
  id: EmployeeDocumentId,
  employeeId: EmployeeId,
  category: EmployeeDocumentCategorySchema,
  /** 문서가 들어온 곳입니다. 직접 올리기(`UPLOAD`)와 증명서 발급(`CERTIFICATE`)은 아직 없습니다. */
  origin: Schema.Literals(['ESIGN']),
  title: Schema.String,
  /** 서명 완료 PDF입니다. 내려받기는 파일 저장소가 생기면 붙입니다. */
  fileId: FileId,
  esignRequestId: EsignRequestId,
  signedAt: Schema.String,
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
  origin: 'ESIGN'
  title: string
  fileId: Id<'file'>
  esignRequestId: Id<'esignRequest'>
  signedAt: string
  status: 'ACTIVE' | 'VOIDED'
  voidedAt?: string | undefined
  links: ReadonlyArray<EmployeeDocumentLink>
}

/** 문서 보관함 저장소입니다. 서명·발급에서 온 문서는 원본 보존을 위해 지우지 않습니다. */
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
  }
>()('semu/hr/EmployeeDocumentRepository') {
  /** `hr_employee_documents` 표에 둡니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<EmployeeDocumentRecord> = []) =>
    Layer.effect(
      EmployeeDocumentRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<EmployeeDocumentRecord>('hr_employee_documents', {
          seed,
          companyOf: (record) => record.companyId,
        })
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
