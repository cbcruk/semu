import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { SealedSecret } from '../credentials/credential-vault.ts'
import { InstitutionTypeSchema } from '../institutions/institution.ts'
import { CertificateId, CertificateStatusSchema, IntegrationId } from '../integrations/integration.ts'
import type { CertificateOwnerType, CertificateUsage } from './certificate-eligibility.types.ts'

/**
 * 회사가 등록한 공동인증서입니다. 인증서 원문·개인키·서명 비밀번호는 응답에 넣지 않습니다.
 *
 * `usableFor`는 이 인증서로 연동할 수 있는 기관입니다. 현행 연동 화면이 클라이언트에서 그리던 `가능`/`불가`를 서버가 정합니다.
 */
export const SigningCertificate = Schema.Struct({
  id: CertificateId,
  /** 인증서 소유자 이름(CN)입니다. */
  name: Schema.String,
  ownerType: Schema.Literals(['PERSONAL', 'BUSINESS']),
  usage: Schema.Literals(['GENERAL', 'BANK', 'ETAX']),
  /** 발급기관 코드입니다. 예: `yessign` */
  issuerCode: Schema.String,
  serialNumber: Schema.String,
  issuedOn: Schema.String,
  expiresOn: Schema.String,
  status: CertificateStatusSchema,
  /** 만료일까지 남은 날입니다. 오늘 만료면 0입니다. */
  remainingDays: Schema.Int,
  usableFor: Schema.Array(InstitutionTypeSchema),
  linkedIntegrationIds: Schema.Array(IntegrationId),
  registeredAt: Schema.String,
})

/** 공동인증서입니다. */
export type SigningCertificate = typeof SigningCertificate.Type

/** 저장소가 가진 인증서입니다. */
export interface CertificateRecord {
  id: Id<'certificate'>
  companyId: Id<'company'>
  name: string
  oid: string
  ownerType: CertificateOwnerType
  usage: CertificateUsage
  issuerCode: string
  serialNumber: string
  issuedOn: string
  expiresOn: string
  /** 기관에서 폐기·비밀번호 변경을 감지하면 `INACTIVE`입니다. `EXPIRED`는 저장하지 않고 파생합니다. */
  storedStatus: 'ACTIVE' | 'INACTIVE'
  /** 봉한 인증서 묶음과 서명 비밀번호(`bundle`, `signPassword`)입니다. */
  secret: SealedSecret
  registeredBy: Id<'user'>
  registeredAt: string
  deletedAt?: string
}

/** 로컬 인증서 프로그램(ExAdapter)이 읽어 올린 인증서입니다. */
export const CertificateUpload = Schema.Struct({
  name: Schema.NonEmptyString,
  oid: Schema.NonEmptyString,
  serialNumber: Schema.NonEmptyString,
  issuedOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  expiresOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  ownerBusinessNumber: Schema.optionalKey(Schema.String),
  ownerName: Schema.optionalKey(Schema.String),
  /** 로컬 프로그램이 서버 공개키로 암호화한 인증서·개인키 묶음입니다. */
  encryptedBundle: Schema.NonEmptyString,
  signPassword: Schema.NonEmptyString,
})

/** 인증서 등록 요청입니다. */
export type CertificateUpload = typeof CertificateUpload.Type

/** 인터넷지로 간편가입 요청입니다. 지로 ID·비밀번호는 저장하지 않습니다. */
export const GiroSignupRequest = Schema.Struct({
  giroLoginId: Schema.NonEmptyString,
  giroPassword: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  phone: Schema.String.check(Schema.isPattern(/^\d{9,11}$/)),
  /** 인터넷지로 약관 6종에 모두 동의했는지입니다. */
  agreedToGiroTerms: Schema.Literal(true),
})

/** 요청한 인증서가 이 회사에 없습니다. */
export class CertificateNotFound extends HttpApiError.Problem<CertificateNotFound>()(
  'CertificateNotFound',
  { type: problemType('CERTIFICATE_NOT_FOUND'), status: 404, title: 'Certificate not found' },
  { code: Schema.tag('CERTIFICATE_NOT_FOUND') },
) {}

/** 이 회사에 등록할 수 없는 인증서입니다. 현행 "등록할 수 없는 인증서"입니다. */
export class CertificateNotAccepted extends HttpApiError.Problem<CertificateNotAccepted>()(
  'CertificateNotAccepted',
  { type: problemType('CERTIFICATE_NOT_ACCEPTED'), status: 422, title: 'Certificate cannot be registered' },
  {
    code: Schema.tag('CERTIFICATE_NOT_ACCEPTED'),
    reason: Schema.Literals(['OID_UNKNOWN', 'EXPIRED', 'TYPE_NOT_ALLOWED', 'OWNER_MISMATCH']),
    field: Schema.String,
  },
) {}

/** 같은 일련번호의 인증서가 이미 있습니다. */
export class CertificateDuplicate extends HttpApiError.Problem<CertificateDuplicate>()(
  'CertificateDuplicate',
  { type: problemType('CERTIFICATE_DUPLICATE'), status: 409, title: 'Certificate already registered' },
  { code: Schema.tag('CERTIFICATE_DUPLICATE'), certificateId: CertificateId },
) {}

/** 서명 비밀번호가 맞지 않습니다. */
export class CertificatePasswordIncorrect extends HttpApiError.Problem<CertificatePasswordIncorrect>()(
  'CertificatePasswordIncorrect',
  { type: problemType('CERTIFICATE_PASSWORD_INCORRECT'), status: 422, title: 'Signing password is incorrect' },
  { code: Schema.tag('CERTIFICATE_PASSWORD_INCORRECT') },
) {}

/** 인터넷지로가 간편가입을 거절했습니다. */
export class GiroSignupRejected extends HttpApiError.Problem<GiroSignupRejected>()(
  'GiroSignupRejected',
  { type: problemType('GIRO_SIGNUP_REJECTED'), status: 422, title: 'Internet Giro rejected the sign-up' },
  { code: Schema.tag('GIRO_SIGNUP_REJECTED'), reason: Schema.String },
) {}
