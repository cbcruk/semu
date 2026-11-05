import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, EsignRequestId, IfMatchHeaders } from '../shared/documents-schemas.ts'
import {
  EsignRequest,
  EsignRequestDraft,
  EsignRequestInvalid,
  EsignRequestNotFound,
  EsignRequestStatusSchema,
  EsignRequestTransitionInvalid,
} from './esign-request.ts'

const params = { id: EsignRequestId }
const withEtag = HttpApiSchema.WithHeaders(EsignRequest, { etag: Schema.String })
const commandErrors = [...ACCESS_ERRORS, EsignRequestNotFound, EsignRequestTransitionInvalid, VersionMismatch]
/** 발송 응답입니다. 링크 복사를 위해 서명 주소를 이번 응답에만 담습니다. */
const sent = HttpApiSchema.WithHeaders(Schema.Struct({ ...EsignRequest.fields, signingUrl: Schema.String }), {
  etag: Schema.String,
})

/**
 * 전자서명 요청입니다. 초안만 고치고 지울 수 있고, 상태는 커맨드(`POST /esign-requests/{id}:{command}`)로 바꿉니다.
 *
 * 응답의 `allowedActions`가 지금 받을 수 있는 커맨드입니다.
 */
export class EsignRequestsApi extends HttpApiGroup.make('esignRequests')
  .add(
    HttpApiEndpoint.get('list', '/esign-requests', {
      query: { status: Schema.optionalKey(EsignRequestStatusSchema), ...PageQueryFields },
      success: Page(EsignRequest),
      error: ACCESS_ERRORS,
    }),
    HttpApiEndpoint.post('create', '/esign-requests', {
      payload: EsignRequestDraft,
      success: EsignRequest.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EsignRequestInvalid],
    }),
    HttpApiEndpoint.get('get', '/esign-requests/:id', {
      params,
      success: withEtag,
      error: [...ACCESS_ERRORS, EsignRequestNotFound],
    }),
    HttpApiEndpoint.put('update', '/esign-requests/:id', {
      params,
      headers: IfMatchHeaders,
      payload: EsignRequestDraft,
      success: withEtag,
      error: [...commandErrors, EsignRequestInvalid],
    }),
    HttpApiEndpoint.delete('remove', '/esign-requests/:id', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, EsignRequestNotFound, EsignRequestTransitionInvalid],
    }),
    HttpApiEndpoint.post('send', '/esign-requests/:id::send', {
      params,
      headers: IfMatchHeaders,
      success: sent,
      error: [...commandErrors, EsignRequestInvalid],
    }),
    HttpApiEndpoint.post('resend', '/esign-requests/:id::resend', {
      params,
      headers: IfMatchHeaders,
      success: sent,
      error: [...commandErrors, EsignRequestInvalid],
    }),
    HttpApiEndpoint.post('revertToDraft', '/esign-requests/:id::revert-to-draft', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('cancel', '/esign-requests/:id::cancel', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('void', '/esign-requests/:id::void', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: commandErrors,
    }),
  )
  .middleware(Authentication) {}
