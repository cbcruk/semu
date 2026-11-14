import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { EsignRequestStatusSchema } from '../esign/esign-request.ts'
import { FileId } from '../shared/documents-schemas.ts'
import {
  EsignLinkClosed,
  EsignLinkNotFound,
  EsignVerificationFailed,
  EsignVerificationLocked,
  SignerSessionInvalid,
} from './signing-errors.ts'

const params = { token: Schema.String }

/**
 * 서명자가 메일 링크로 들어오는 비로그인 경로입니다. 인증 대신 링크 토큰과, 본인확인 뒤 받는 세션 토큰(`X-Signer-Session`)을 씁니다.
 *
 * 본인확인을 다섯 번 틀리면 잠기고(429), 세션은 30분 유지됩니다.
 */
export class EsignLinksApi extends HttpApiGroup.make('esignLinks').add(
  HttpApiEndpoint.get('summary', '/esign-links/:token', {
    params,
    success: Schema.Struct({
      title: Schema.String,
      /** 가린 이름입니다. 예: `홍*동` */
      recipientName: Schema.String,
      status: EsignRequestStatusSchema,
      dueDate: Schema.optionalKey(CalendarDate),
      documents: Schema.Array(Schema.Struct({ index: Schema.Int, title: Schema.String })),
    }),
    error: EsignLinkNotFound,
  }),
  HttpApiEndpoint.post('verify', '/esign-links/:token::verify', {
    params,
    payload: Schema.Struct({ name: Schema.NonEmptyString, birthDate: Schema.optionalKey(CalendarDate) }),
    success: Schema.Struct({ sessionToken: Schema.String, expiresAt: Schema.String }),
    error: [EsignLinkNotFound, EsignLinkClosed, EsignVerificationFailed, EsignVerificationLocked],
  }),
  HttpApiEndpoint.post('complete', '/esign-links/:token::complete', {
    params,
    headers: { 'x-signer-session': Schema.optionalKey(Schema.String) },
    payload: Schema.Struct({
      /** 문서 번호별 서명자 입력값입니다. 예: `{ "0": { "signerAddress": "서울시 ..." } }` */
      signerValues: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
    }),
    success: Schema.Struct({ status: Schema.Literal('COMPLETED'), resultFileId: FileId }),
    error: [EsignLinkNotFound, EsignLinkClosed, SignerSessionInvalid],
  }),
) {}
