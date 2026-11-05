import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import {
  CompanySealId,
  EmployeeId,
  EsignRequestId,
  EsignTemplateId,
  FileId,
  Violations,
} from '../shared/documents-schemas.ts'
import { TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { EsignRequestStatus } from './esign-request-status.types.ts'

/** 전자서명 요청 상태입니다. */
export const EsignRequestStatusSchema = Schema.Literals([
  'DRAFT',
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'VOIDED',
  'EXPIRED',
  'CANCELED',
  'SEND_FAILED',
])

/** 관리자 커맨드입니다. 화면 버튼을 켜는 `allowedActions`에 씁니다. */
export const EsignRequestActionSchema = Schema.Literals([
  'UPDATE',
  'DELETE',
  'SEND',
  'RESEND',
  'REVERT_TO_DRAFT',
  'CANCEL',
  'VOID',
  'DOWNLOAD',
])

/** 서명 받을 사람입니다. 직원이면 `employeeId`를 주고, 빈 값은 인사 정보로 채웁니다. */
export const Recipient = Schema.Struct({
  employeeId: Schema.optionalKey(EmployeeId),
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  phone: Schema.optionalKey(Schema.String),
  isForeigner: Schema.optionalKey(Schema.Boolean),
  nationalityCode: Schema.optionalKey(Schema.String),
  visaCode: Schema.optionalKey(Schema.String),
})

const FieldValues = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
const HiddenFields = Schema.Record(Schema.String, Schema.Array(Schema.String))

/** 초안 본문입니다. 문서 번호는 `templateIds` 순서(0부터)입니다. */
export const EsignRequestDraft = Schema.Struct({
  title: Schema.NonEmptyString,
  recipient: Recipient,
  templateIds: Schema.Array(EsignTemplateId),
  /** 문서 번호별 관리자 입력값입니다. 예: `{ "0": { "workPlace": "본사" } }` */
  fieldValues: Schema.optionalKey(FieldValues),
  /** 문서 번호별로 숨긴 조항 필드 키입니다. */
  hiddenFields: Schema.optionalKey(HiddenFields),
  companySealId: Schema.optionalKey(CompanySealId),
  dueDate: Schema.optionalKey(CalendarDate),
})

/** 전자서명 요청 응답입니다. */
export const EsignRequest = Schema.Struct({
  id: EsignRequestId,
  title: Schema.String,
  status: EsignRequestStatusSchema,
  allowedActions: Schema.Array(EsignRequestActionSchema),
  recipient: Schema.Struct({ ...Recipient.fields, name: Schema.String, isForeigner: Schema.Boolean }),
  templateIds: Schema.Array(EsignTemplateId),
  fieldValues: FieldValues,
  hiddenFields: HiddenFields,
  companySealId: Schema.optionalKey(CompanySealId),
  dueDate: Schema.optionalKey(CalendarDate),
  sentAt: Schema.optionalKey(Schema.String),
  completedAt: Schema.optionalKey(Schema.String),
  resultFileId: Schema.optionalKey(FileId),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 전자서명 요청 응답의 타입입니다. */
export type EsignRequest = typeof EsignRequest.Type

/** 서명자 세션입니다. 토큰은 해시로만 저장합니다. */
export interface SignerSession {
  tokenHash: string
  expiresAt: string
}

/** 저장하는 전자서명 요청입니다. */
export interface EsignRequestRecord {
  id: Id<'esignRequest'>
  companyId: Id<'company'>
  title: string
  status: EsignRequestStatus
  recipient: {
    employeeId?: Id<'employee'> | undefined
    name: string
    email?: string | undefined
    phone?: string | undefined
    isForeigner: boolean
    nationalityCode?: string | undefined
    visaCode?: string | undefined
  }
  templateIds: ReadonlyArray<Id<'esignTemplate'>>
  fieldValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  hiddenFields: Readonly<Record<string, ReadonlyArray<string>>>
  companySealId?: Id<'companySeal'> | undefined
  dueDate?: string | undefined
  sentAt?: string | undefined
  completedAt?: string | undefined
  resultFileId?: Id<'file'> | undefined
  /** 서명 링크 토큰의 해시입니다. 발송할 때마다 새로 만듭니다. */
  linkTokenHash?: string | undefined
  verifyFailures: number
  sessions: ReadonlyArray<SignerSession>
  version: number
  createdAt: string
  updatedAt: string
}

/** 전자서명 요청 저장소입니다. */
export class EsignRequestRepository extends Context.Service<
  EsignRequestRepository,
  TenantTable<EsignRequestRecord> & {
    /** 서명 링크 토큰 해시로 찾습니다. 비로그인 링크라 회사와 상관없이 찾습니다. */
    findByLinkTokenHash(hash: string): Effect.Effect<Option.Option<EsignRequestRecord>>
  }
>()('semu/documents/EsignRequestRepository') {
  /** `documents_esign_requests` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<EsignRequestRecord> = []) =>
    Layer.effect(
      EsignRequestRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<EsignRequestRecord>('documents_esign_requests', {
          seed,
          companyOf: (record) => record.companyId,
        })
        return EsignRequestRepository.of({
          list: (companyId) => table.byCompany(companyId),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((record) => record.companyId === companyId),
            ),
          save: (record) => table.put(record),
          remove: (companyId, id) =>
            Effect.flatMap(table.get(id), (found) =>
              Option.isSome(found) && found.value.companyId === companyId ? table.remove(id) : Effect.void,
            ),
          findByLinkTokenHash: (hash) =>
            Effect.map(table.all(), (records) =>
              Option.fromNullishOr(records.find((record) => record.linkTokenHash === hash)),
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 요청을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EsignRequestRecord> = []) =>
    EsignRequestRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 요청이 없거나 다른 회사의 요청입니다. */
export class EsignRequestNotFound extends HttpApiError.Problem<EsignRequestNotFound>()(
  'EsignRequestNotFound',
  { type: problemType('ESIGN_REQUEST_NOT_FOUND'), status: 404, title: 'E-sign request not found' },
  { code: Schema.tag('ESIGN_REQUEST_NOT_FOUND') },
) {}

/** 지금 상태에서 받을 수 없는 커맨드입니다. 발송 뒤에는 수정·삭제할 수 없습니다. */
export class EsignRequestTransitionInvalid extends HttpApiError.Problem<EsignRequestTransitionInvalid>()(
  'EsignRequestTransitionInvalid',
  { type: problemType('ESIGN_REQUEST_TRANSITION_INVALID'), status: 409, title: 'Status does not allow this command' },
  {
    code: Schema.tag('ESIGN_REQUEST_TRANSITION_INVALID'),
    currentStatus: EsignRequestStatusSchema,
    command: Schema.String,
  },
) {}

/** 요청 내용이 규칙을 어겼습니다. 발송 검증 위반을 모두 담습니다. */
export class EsignRequestInvalid extends HttpApiError.Problem<EsignRequestInvalid>()(
  'EsignRequestInvalid',
  { type: problemType('ESIGN_REQUEST_INVALID'), status: 422, title: 'E-sign request violates a rule' },
  { code: Schema.tag('ESIGN_REQUEST_INVALID'), violations: Violations },
) {}
