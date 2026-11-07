import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  ExternalOutcomeUnknown,
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import { BillingMandate, MandateRegistration, MandateRejected } from './billing-mandate.ts'

/**
 * CMS 자동출금 동의(결제 수단)입니다. 현행 공개 `withdrawal-consent`를 로그인한 회사의 리소스로 옮겼습니다.
 *
 * 등록은 은행망에 계좌를 등록하는 외부 효과라 `Idempotency-Key`가 필요합니다. 같은 키·같은 본문의 재요청은 처음 응답을 돌려받고,
 * 은행 응답을 확인하지 못했으면 503 `EXTERNAL_OUTCOME_UNKNOWN`입니다(conventions.md 멱등성).
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
      error: [
        ...accessErrors,
        MandateRejected,
        IdempotencyKeyRequired,
        IdempotencyKeyReused,
        IdempotencyKeyInProgress,
        ExternalOutcomeUnknown,
      ],
    }),
  )
  .middleware(Authentication) {}
