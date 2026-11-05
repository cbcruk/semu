import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdempotencyKeyRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import { BillingMandate, MandateRegistration, MandateRejected } from './billing-mandate.ts'

/**
 * CMS 자동출금 동의(결제 수단)입니다. 현행 공개 `withdrawal-consent`를 로그인한 회사의 리소스로 옮겼습니다.
 *
 * 등록은 은행망에 계좌를 등록하는 외부 효과라 `Idempotency-Key`가 필요합니다.
 */
export class BillingMandatesApi extends HttpApiGroup.make('billingMandates')
  .add(
    HttpApiEndpoint.get('list', '/billing-mandates', {
      success: Schema.Struct({ items: Schema.Array(BillingMandate) }),
      error: accessErrors,
    }),
    HttpApiEndpoint.post('register', '/billing-mandates', {
      headers: { 'idempotency-key': Schema.optionalKey(Schema.String) },
      payload: MandateRegistration,
      success: HttpApiSchema.status(201)(BillingMandate),
      error: [...accessErrors, MandateRejected, IdempotencyKeyRequired],
    }),
  )
  .middleware(Authentication) {}
