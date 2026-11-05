import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CertificateIssuanceId, EmployeeId, EsignTemplateId, Violations } from '../shared/documents-schemas.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { CertificateStatus } from './certificate-rules.types.ts'

/** 제증명 발급 상태입니다. */
export const CertificateStatusSchema = Schema.Literals(['ISSUED', 'SENDING', 'SENT', 'SEND_FAILED', 'VOIDED'])

/** 제증명 발급 본문입니다. */
export const IssueCertificate = Schema.Struct({
  templateId: EsignTemplateId,
  employeeId: EmployeeId,
  purpose: Schema.optionalKey(Schema.String),
  /** 받을 메일 주소입니다. 없으면 직원 메일로 보냅니다. */
  recipientEmail: Schema.optionalKey(Schema.String),
})

/** 제증명 발급 응답입니다. */
export const CertificateIssuance = Schema.Struct({
  id: CertificateIssuanceId,
  templateId: EsignTemplateId,
  employeeId: EmployeeId,
  /** 회사·연도별 발급번호입니다. 예: `2026-0007` */
  issueNumber: Schema.String,
  status: CertificateStatusSchema,
  allowedActions: Schema.Array(Schema.Literals(['SEND', 'VOID'])),
  purpose: Schema.optionalKey(Schema.String),
  recipientEmail: Schema.optionalKey(Schema.String),
  issuedAt: Schema.String,
  sentAt: Schema.optionalKey(Schema.String),
  linkExpiresAt: Schema.optionalKey(Schema.String),
  voidedAt: Schema.optionalKey(Schema.String),
  version: Schema.Int,
})

/** 제증명 발급 응답의 타입입니다. */
export type CertificateIssuance = typeof CertificateIssuance.Type

/** 저장하는 제증명 발급입니다. */
export interface CertificateIssuanceRecord {
  id: Id<'certificateIssuance'>
  companyId: Id<'company'>
  templateId: Id<'esignTemplate'>
  employeeId: Id<'employee'>
  issueNumber: string
  status: CertificateStatus
  purpose?: string | undefined
  recipientEmail?: string | undefined
  issuedAt: string
  sentAt?: string | undefined
  linkExpiresAt?: string | undefined
  voidedAt?: string | undefined
  version: number
}

/** 제증명 발급 저장소입니다. */
export class CertificateIssuanceRepository extends Context.Service<
  CertificateIssuanceRepository,
  TenantTable<CertificateIssuanceRecord>
>()('semu/documents/CertificateIssuanceRepository') {
  /** `documents_certificate_issuances` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<CertificateIssuanceRecord> = []) =>
    Layer.effect(
      CertificateIssuanceRepository,
      makeTenantTable<CertificateIssuanceRecord>('documents_certificate_issuances', seed),
    )

  /** `seed`로 시작해 프로세스 메모리에 발급 기록을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<CertificateIssuanceRecord> = []) =>
    CertificateIssuanceRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 발급 기록이 없습니다. */
export class CertificateNotFound extends HttpApiError.Problem<CertificateNotFound>()(
  'CertificateNotFound',
  { type: problemType('CERTIFICATE_NOT_FOUND'), status: 404, title: 'Certificate not found' },
  { code: Schema.tag('CERTIFICATE_NOT_FOUND') },
) {}

/** 지금 상태에서 받을 수 없는 커맨드입니다. 발송 중에는 다시 보내거나 무효로 할 수 없습니다. */
export class CertificateTransitionInvalid extends HttpApiError.Problem<CertificateTransitionInvalid>()(
  'CertificateTransitionInvalid',
  { type: problemType('CERTIFICATE_TRANSITION_INVALID'), status: 409, title: 'Status does not allow this command' },
  { code: Schema.tag('CERTIFICATE_TRANSITION_INVALID'), currentStatus: CertificateStatusSchema },
) {}

/** 발급 입력이 규칙을 어겼습니다. 예: 퇴사일 없는 직원의 퇴직증명서 */
export class CertificateInvalid extends HttpApiError.Problem<CertificateInvalid>()(
  'CertificateInvalid',
  { type: problemType('CERTIFICATE_INVALID'), status: 422, title: 'Certificate input violates a rule' },
  { code: Schema.tag('CERTIFICATE_INVALID'), violations: Violations },
) {}
