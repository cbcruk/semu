import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, CertificateIssuanceId, IfMatchHeaders } from '../shared/documents-schemas.ts'
import {
  CertificateInvalid,
  CertificateIssuance,
  CertificateNotFound,
  CertificateTransitionInvalid,
  IssueCertificate,
} from './certificate-issuance.ts'

const params = { id: CertificateIssuanceId }
const withEtag = HttpApiSchema.WithHeaders(CertificateIssuance, { etag: Schema.String })
const commandErrors = [...ACCESS_ERRORS, CertificateNotFound, CertificateTransitionInvalid, VersionMismatch]

/** 제증명 발급입니다. 발급하면 번호를 매기고, `:send`로 링크를 보내며, 지우지 않고 `:void`로 무효화합니다. */
export class CertificatesApi extends HttpApiGroup.make('certificateIssuances')
  .add(
    HttpApiEndpoint.get('list', '/certificate-issuances', {
      query: PageQueryFields,
      success: Page(CertificateIssuance),
      error: ACCESS_ERRORS,
    }),
    HttpApiEndpoint.post('issue', '/certificate-issuances', {
      payload: IssueCertificate,
      success: CertificateIssuance.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, CertificateInvalid],
    }),
    HttpApiEndpoint.get('get', '/certificate-issuances/:id', {
      params,
      success: withEtag,
      error: [...ACCESS_ERRORS, CertificateNotFound],
    }),
    HttpApiEndpoint.post('send', '/certificate-issuances/:id::send', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: [...commandErrors, CertificateInvalid],
    }),
    HttpApiEndpoint.post('void', '/certificate-issuances/:id::void', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: commandErrors,
    }),
  )
  .middleware(Authentication) {}
