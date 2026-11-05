import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { CertificateId, CertificateNotUsable } from '../integrations/integration.ts'
import {
  CertificateDuplicate,
  CertificateNotAccepted,
  CertificateNotFound,
  CertificatePasswordIncorrect,
  CertificateUpload,
  GiroSignupRejected,
  GiroSignupRequest,
  SigningCertificate,
} from './certificate.ts'

const certificateParams = { certificateId: CertificateId }

/**
 * 공동인증서 관리입니다. 현행 `/cert/*`(설정 > 공동 인증서 관리)를 대신합니다.
 *
 * 등록 본문은 로컬 인증서 프로그램이 만든 암호화 묶음과 공개 정보입니다.
 */
export class SigningCertificatesApi extends HttpApiGroup.make('signingCertificates')
  .add(
    HttpApiEndpoint.get('list', '/certificates', {
      success: Schema.Struct({ items: Schema.Array(SigningCertificate) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.post('register', '/certificates', {
      payload: CertificateUpload,
      success: SigningCertificate.pipe(HttpApiSchema.status(201)),
      error: [PermissionDenied, CertificateNotAccepted, CertificateDuplicate, CertificatePasswordIncorrect],
    }),
    HttpApiEndpoint.delete('remove', '/certificates/:certificateId', {
      params: certificateParams,
      success: HttpApiSchema.NoContent,
      error: [PermissionDenied, CertificateNotFound],
    }),
    HttpApiEndpoint.post('verifyPassword', '/certificates/:certificateId::verify-password', {
      params: certificateParams,
      payload: Schema.Struct({ signPassword: Schema.NonEmptyString }),
      success: HttpApiSchema.NoContent,
      error: [PermissionDenied, CertificateNotFound, CertificatePasswordIncorrect],
    }),
    HttpApiEndpoint.post('joinGiro', '/certificates/:certificateId::join-giro', {
      params: certificateParams,
      payload: GiroSignupRequest,
      success: HttpApiSchema.NoContent,
      error: [PermissionDenied, CertificateNotFound, CertificateNotUsable, GiroSignupRejected],
    }),
  )
  .middleware(Authentication) {}
