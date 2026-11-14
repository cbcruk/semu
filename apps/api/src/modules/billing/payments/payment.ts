import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PageQueryFields } from '../../../shared/http/pagination.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { Plan } from '../../identity-access/actor.types.ts'
import { DateSchema, PlanSchema } from '../subscriptions/subscription.ts'
import type { PaymentStatus } from './payment-schedule.types.ts'

/** 결제 ID입니다. */
export type PaymentId = Id<'payment'>

/** 결제 상태 스키마입니다. 전이는 `payment-schedule.ts`에 있습니다. */
export const PaymentStatusSchema = Schema.Literals(['SCHEDULED', 'PAID', 'FAILED', 'RETRYING', 'REFUNDED', 'CANCELED'])

/** 출금 실패 사유입니다. CMS 결과 코드를 이 값으로 옮깁니다. */
export const PaymentFailureReason = Schema.Literals([
  'INSUFFICIENT_BALANCE',
  'ACCOUNT_CLOSED',
  'MANDATE_NOT_REGISTERED',
  'OTHER',
])
export type PaymentFailureReason = typeof PaymentFailureReason.Type

/** 출금 계좌 표시입니다. 계좌번호는 끝 4자리만 줍니다. */
export const PaymentAccount = Schema.Struct({ bankCode: Schema.String, accountNumberMasked: Schema.String })

/** 정기결제 한 건입니다. 현행 결제 내역 표의 행입니다. */
export const Payment = Schema.Struct({
  id: IdSchema('payment'),
  /** 화면에 보이는 결제 번호입니다. 자체 부여이고 연속하지 않을 수 있습니다. */
  number: Schema.Int,
  plan: PlanSchema,
  /** 원 단위, VAT 포함입니다. */
  amount: Schema.Int,
  /** 출금일(재시도면 다시 출금하는 날)입니다. 비영업일이면 이미 다음 영업일로 미룬 날입니다. */
  scheduledOn: DateSchema,
  status: PaymentStatusSchema,
  failureReason: Schema.optionalKey(PaymentFailureReason),
  /** 결과가 반영될 날입니다. 예정·재시도 중일 때만 있습니다(출금 다음 날 오후). */
  resultExpectedOn: Schema.optionalKey(DateSchema),
  account: Schema.optionalKey(PaymentAccount),
  settledAt: Schema.optionalKey(Schema.String),
  refundedAt: Schema.optionalKey(Schema.String),
  canceledAt: Schema.optionalKey(Schema.String),
  /** 세무 대리인 담당자만 받습니다. 고객에게는 항상 비어 있습니다. */
  allowedActions: Schema.Array(Schema.Literals(['RETRY', 'REFUND'])),
  version: Schema.Int,
})
export type Payment = typeof Payment.Type

/** 저장하는 결제입니다. */
export interface PaymentRecord {
  id: PaymentId
  number: number
  companyId: Id<'company'>
  subscriptionId: Id<'subscription'>
  plan: Plan
  amount: number
  scheduledOn: string
  status: PaymentStatus
  mandateId?: Id<'billingMandate'> | undefined
  failureReason?: PaymentFailureReason | undefined
  settledAt?: string | undefined
  refundedAt?: string | undefined
  /** 결제 예정을 취소한 시각입니다. */
  canceledAt?: string | undefined
  createdAt: string
  version: number
}

/** 결제 목록 쿼리입니다. */
export const PaymentListQuery = Schema.Struct({ ...PageQueryFields, status: Schema.optionalKey(PaymentStatusSchema) })

/** 재시도 요청입니다. `retryOn`이 없으면 오늘 다음 영업일에 출금합니다. */
export const PaymentRetry = Schema.Struct({ retryOn: Schema.optionalKey(DateSchema) })

/** 결제가 없거나 결제 내역에 보이지 않는 상품입니다. */
export class PaymentNotFound extends HttpApiError.Problem<PaymentNotFound>()(
  'PaymentNotFound',
  { type: problemType('PAYMENT_NOT_FOUND'), status: 404, title: 'Payment not found' },
  { code: Schema.tag('PAYMENT_NOT_FOUND') },
) {}

/** 지금 상태에서 할 수 없는 커맨드입니다. 재시도는 실패 건만, 환불은 완료 건만 됩니다. */
export class PaymentTransitionInvalid extends HttpApiError.Problem<PaymentTransitionInvalid>()(
  'PaymentTransitionInvalid',
  { type: problemType('PAYMENT_TRANSITION_INVALID'), status: 409, title: 'Payment cannot change this way' },
  { code: Schema.tag('PAYMENT_TRANSITION_INVALID'), currentStatus: PaymentStatusSchema },
) {}

/** 재시도 출금일이 오늘보다 앞섭니다. */
export class RetryDateInvalid extends HttpApiError.Problem<RetryDateInvalid>()(
  'RetryDateInvalid',
  { type: problemType('RETRY_DATE_INVALID'), status: 422, title: 'Retry date is in the past' },
  { code: Schema.tag('RETRY_DATE_INVALID') },
) {}
