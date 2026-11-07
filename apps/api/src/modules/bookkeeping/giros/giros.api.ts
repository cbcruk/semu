import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  ExternalOutcomeUnknown,
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
  PermissionDenied,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { GiroId } from '../common/ids.ts'
import { IdempotencyHeaders, IfMatchHeaders, Won } from '../common/wire.ts'
import { Giro, GiroNotFound, GiroPaymentFailed, GiroStatus, GiroTransitionInvalid } from './giro.ts'

const params = { giroId: GiroId }
const success = HttpApiSchema.WithHeaders(Giro, { etag: Schema.String })

/**
 * 인터넷지로 고지서입니다. 고지서는 수집으로만 생기고, 사람은 수동 완료·숨김·앱 납부 커맨드를 보냅니다.
 *
 * 앱 납부(`:pay`)는 돈이 나가므로 `Idempotency-Key`가 필수입니다. 같은 키·같은 본문의 재요청은 처음 응답을 돌려받고, 납부 결과를
 * 확인하지 못했으면 503 `EXTERNAL_OUTCOME_UNKNOWN`입니다(conventions.md 멱등성).
 */
export class GirosApi extends HttpApiGroup.make('giros')
  .add(
    HttpApiEndpoint.get('list', '/giros', {
      query: Schema.Struct({ status: Schema.optionalKey(GiroStatus) }),
      success: Schema.Struct({ items: Schema.Array(Giro) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('summary', '/giros::summary', {
      success: Schema.Struct({ todoCount: Schema.Int, todoAmount: Won, unknownCount: Schema.Int }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/giros/:giroId', {
      params,
      success,
      error: [GiroNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.post('markPaid', '/giros/:giroId::mark-paid', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({ memo: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))) }),
      success,
      error: [GiroNotFound, GiroTransitionInvalid, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('hide', '/giros/:giroId::hide', {
      params,
      headers: IfMatchHeaders,
      success,
      error: [GiroNotFound, GiroTransitionInvalid, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('pay', '/giros/:giroId::pay', {
      params,
      headers: IdempotencyHeaders,
      payload: Schema.Struct({
        bankCode: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(3)),
        accountNumber: Schema.String.check(Schema.isMinLength(4)),
        /** 계좌 비밀번호입니다. 저장하지 않고 납부 요청에만 씁니다. */
        accountPassword: Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(4)),
      }),
      success,
      error: [
        IdempotencyKeyRequired,
        IdempotencyKeyReused,
        IdempotencyKeyInProgress,
        ExternalOutcomeUnknown,
        GiroNotFound,
        GiroTransitionInvalid,
        GiroPaymentFailed,
        PermissionDenied,
      ],
    }),
  )
  .middleware(Authentication) {}
