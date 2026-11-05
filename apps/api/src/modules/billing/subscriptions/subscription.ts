import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { Plan } from '../../identity-access/actor.types.ts'
import type { SubscriptionStatus } from './subscription-entitlement.types.ts'

/** 구독 ID입니다. */
export type SubscriptionId = Id<'subscription'>

/** 유료 플랜입니다. 상품과 1:1입니다(`TAXATION` = 세무 아웃소싱, `PAYROLL` = 급여 아웃소싱). */
export const PlanSchema = Schema.Literals(['TAXATION', 'PAYROLL'])

/** 구독 상태 스키마입니다. 전이는 `subscription-entitlement.ts`에 있습니다. */
export const SubscriptionStatusSchema = Schema.Literals(['PENDING', 'ACTIVE', 'CANCELLATION_SCHEDULED', 'ENDED'])

/** `YYYY-MM-DD` 날짜입니다. */
export const DateSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)))

/** 회사의 유료 상품 구독 한 건입니다. 상태는 읽을 때 오늘 날짜로 다시 계산합니다. */
export const Subscription = Schema.Struct({
  id: IdSchema('subscription'),
  plan: PlanSchema,
  status: SubscriptionStatusSchema,
  /** 오늘 이 구독으로 플랜을 쓸 수 있는지입니다. 해지 예약 중에도 종료일까지 `true`입니다. */
  isEntitled: Schema.Boolean,
  startsOn: DateSchema,
  endsOn: Schema.optionalKey(DateSchema),
  /** 월 이용료(원, VAT 포함)입니다. 0이면 청구하지 않습니다. */
  monthlyFee: Schema.Int,
  serviceContractId: Schema.optionalKey(IdSchema('serviceContract')),
  /** 세무 대리인 담당자만 받습니다. 고객에게는 항상 비어 있습니다. */
  allowedActions: Schema.Array(Schema.Literals(['CANCEL', 'RESUME'])),
  createdAt: Schema.String,
  version: Schema.Int,
})
export type Subscription = typeof Subscription.Type

/** 저장하는 구독입니다. */
export interface SubscriptionRecord {
  id: SubscriptionId
  companyId: Id<'company'>
  plan: Plan
  status: SubscriptionStatus
  startsOn: string
  endsOn?: string | undefined
  monthlyFee: number
  serviceContractId?: Id<'serviceContract'> | undefined
  createdAt: string
  version: number
}

/** 구독 시작 요청입니다. 시작일이 오늘 이후면 `PENDING`으로 만듭니다. */
export const SubscriptionStart = Schema.Struct({
  plan: PlanSchema,
  startsOn: DateSchema,
  monthlyFee: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  serviceContractId: Schema.optionalKey(IdSchema('serviceContract')),
})

/** 해지 예약 요청입니다. `endsOn`이 마지막 이용일입니다. 시작 전 구독은 날짜와 상관없이 바로 끝납니다. */
export const SubscriptionCancellation = Schema.Struct({ endsOn: DateSchema })

/** 구독이 없습니다. */
export class SubscriptionNotFound extends HttpApiError.Problem<SubscriptionNotFound>()(
  'SubscriptionNotFound',
  { type: problemType('SUBSCRIPTION_NOT_FOUND'), status: 404, title: 'Subscription not found' },
  { code: Schema.tag('SUBSCRIPTION_NOT_FOUND') },
) {}

/** 같은 플랜의 끝나지 않은 구독이 이미 있습니다. */
export class SubscriptionAlreadyExists extends HttpApiError.Problem<SubscriptionAlreadyExists>()(
  'SubscriptionAlreadyExists',
  { type: problemType('SUBSCRIPTION_ALREADY_EXISTS'), status: 409, title: 'Subscription already exists' },
  { code: Schema.tag('SUBSCRIPTION_ALREADY_EXISTS'), subscriptionId: Schema.String },
) {}

/** 지금 상태에서 할 수 없는 커맨드입니다. */
export class SubscriptionTransitionInvalid extends HttpApiError.Problem<SubscriptionTransitionInvalid>()(
  'SubscriptionTransitionInvalid',
  { type: problemType('SUBSCRIPTION_TRANSITION_INVALID'), status: 409, title: 'Subscription cannot change this way' },
  { code: Schema.tag('SUBSCRIPTION_TRANSITION_INVALID'), currentStatus: SubscriptionStatusSchema },
) {}

/** 종료일이 시작일이나 오늘보다 앞섭니다. */
export class SubscriptionEndDateInvalid extends HttpApiError.Problem<SubscriptionEndDateInvalid>()(
  'SubscriptionEndDateInvalid',
  { type: problemType('SUBSCRIPTION_END_DATE_INVALID'), status: 422, title: 'End date is before start or today' },
  { code: Schema.tag('SUBSCRIPTION_END_DATE_INVALID') },
) {}
