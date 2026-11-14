import type { Plan } from '../../identity-access/actor.types.ts'
import type { SubscriptionTerm } from '../subscriptions/subscription-entitlement.types.ts'

/**
 * 결제 상태입니다.
 *
 * - `SCHEDULED`: 결제 예정
 * - `PAID`: 출금 완료
 * - `FAILED`: 출금 실패(잔액 부족 등)
 * - `RETRYING`: 실패 건을 담당자가 다시 출금 요청함
 * - `REFUNDED`: 환불 완료
 * - `CANCELED`: 출금일 전에 구독 자격이 없어져 취소한 결제 예정
 */
export type PaymentStatus = 'SCHEDULED' | 'PAID' | 'FAILED' | 'RETRYING' | 'REFUNDED' | 'CANCELED'

/**
 * 결제 상태를 바꾸는 사건입니다. 출금 결과는 CMS 결과 파일에서, 재시도·환불은 담당자에게서 옵니다. 취소는 결제 예정을 구독·출금
 * 동의에 다시 맞출 때 생깁니다.
 */
export type PaymentEvent = 'WITHDRAWAL_SUCCEEDED' | 'WITHDRAWAL_FAILED' | 'RETRY' | 'REFUND' | 'CANCEL'

/** 담당자가 결제에 할 수 있는 커맨드입니다. */
export type PaymentAction = 'RETRY' | 'REFUND'

/** 정기결제 예정을 만들 구독입니다. */
export interface BillableSubscription extends SubscriptionTerm {
  subscriptionId: string
  /** 월 이용료(원, VAT 포함)입니다. */
  monthlyFee: number
}

/** 이미 만든 결제 예정입니다. 같은 구독·결제일이면 다시 만들지 않습니다. */
export interface ScheduledKey {
  subscriptionId: string
  scheduledOn: string
}

/** 새로 만들 결제 예정입니다. */
export interface PaymentPlanItem {
  subscriptionId: string
  plan: Plan
  amount: number
  scheduledOn: string
}

/** 이미 만든 결제 예정 하나를 지금 구독·출금 동의에 맞춘 결과입니다. */
export type ScheduledPaymentAdjustment =
  { kind: 'KEEP' } | { kind: 'CANCEL' } | { kind: 'UPDATE'; amount: number; mandateId: string | undefined }
