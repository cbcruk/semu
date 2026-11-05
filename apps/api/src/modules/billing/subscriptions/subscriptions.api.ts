import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import {
  Subscription,
  SubscriptionAlreadyExists,
  SubscriptionCancellation,
  SubscriptionEndDateInvalid,
  SubscriptionNotFound,
  SubscriptionStart,
  SubscriptionTransitionInvalid,
} from './subscription.ts'

const params = { subscriptionId: IdSchema('subscription') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const withEtag = HttpApiSchema.WithHeaders(Subscription, { etag: Schema.String })
const transitionErrors = [
  ...accessErrors,
  SubscriptionNotFound,
  SubscriptionTransitionInvalid,
  SubscriptionEndDateInvalid,
  VersionMismatch,
]

/**
 * 회사의 유료 상품 구독입니다. 고객은 읽기만 하고, 시작·해지 예약·철회는 세무 대리인 담당자가 합니다.
 *
 * 플랜(`/me`의 `company.plans`)은 이 구독에서 계산합니다. 현행 `perm/subscription`의 `isSubscribed`가 `isEntitled`입니다.
 */
export class SubscriptionsApi extends HttpApiGroup.make('subscriptions')
  .add(
    HttpApiEndpoint.get('list', '/subscriptions', {
      success: Schema.Struct({ items: Schema.Array(Subscription) }),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('get', '/subscriptions/:subscriptionId', {
      params,
      success: withEtag,
      error: [...accessErrors, SubscriptionNotFound],
    }),
    HttpApiEndpoint.post('start', '/subscriptions', {
      payload: SubscriptionStart,
      success: HttpApiSchema.status(201)(Subscription),
      error: [...accessErrors, SubscriptionAlreadyExists],
    }),
    HttpApiEndpoint.post('cancel', '/subscriptions/:subscriptionId::cancel', {
      params,
      headers: ifMatch,
      payload: SubscriptionCancellation,
      success: withEtag,
      error: transitionErrors,
    }),
    HttpApiEndpoint.post('resume', '/subscriptions/:subscriptionId::resume', {
      params,
      headers: ifMatch,
      success: withEtag,
      error: transitionErrors,
    }),
  )
  .middleware(Authentication) {}
