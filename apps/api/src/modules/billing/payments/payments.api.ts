import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page } from '../../../shared/http/pagination.ts'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { IdempotencyKeyRequired, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import {
  Payment,
  PaymentListQuery,
  PaymentNotFound,
  PaymentRetry,
  PaymentTransitionInvalid,
  RetryDateInvalid,
} from './payment.ts'

const params = { paymentId: IdSchema('payment') }
const commandHeaders = {
  'if-match': Schema.optionalKey(Schema.String),
  'idempotency-key': Schema.optionalKey(Schema.String),
}
const withEtag = HttpApiSchema.WithHeaders(Payment, { etag: Schema.String })

/**
 * 서비스 이용료 정기결제 내역입니다. 고객은 읽기만 하고, 실패 건 재시도와 환불은 세무 대리인 담당자가 합니다.
 *
 * 출금 결과 반영과 월 결제 예정 생성은 작업이라 HTTP로 열지 않습니다.
 */
export class PaymentsApi extends HttpApiGroup.make('payments')
  .add(
    HttpApiEndpoint.get('list', '/payments', {
      query: PaymentListQuery,
      success: Page(Payment),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('get', '/payments/:paymentId', {
      params,
      success: withEtag,
      error: [...accessErrors, PaymentNotFound],
    }),
    HttpApiEndpoint.post('retry', '/payments/:paymentId::retry', {
      params,
      headers: commandHeaders,
      payload: PaymentRetry,
      success: withEtag,
      error: [
        ...accessErrors,
        PaymentNotFound,
        PaymentTransitionInvalid,
        RetryDateInvalid,
        VersionMismatch,
        IdempotencyKeyRequired,
      ],
    }),
    HttpApiEndpoint.post('refund', '/payments/:paymentId::refund', {
      params,
      headers: commandHeaders,
      success: withEtag,
      error: [...accessErrors, PaymentNotFound, PaymentTransitionInvalid, VersionMismatch, IdempotencyKeyRequired],
    }),
  )
  .middleware(Authentication) {}
