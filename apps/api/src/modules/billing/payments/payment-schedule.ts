import { addDays, weekdayIndex } from '../../../shared/time/calendar.ts'
import type { Plan } from '../../identity-access/actor.types.ts'
import { isEntitledOn } from '../subscriptions/subscription-entitlement.ts'
import type {
  BillableSubscription,
  PaymentAction,
  PaymentEvent,
  PaymentPlanItem,
  PaymentStatus,
  ScheduledKey,
} from './payment-schedule.types.ts'

/** 월 이용료를 출금하는 날입니다. 현행 레거시 서버의 제안값(25일)을 따릅니다. */
export const BILLING_DAY = 25

/** 결제 내역에 보여 주는 상품입니다. 2025년 12월 기준 급여 아웃소싱만 CMS로 결제합니다. */
export const LISTED_PAYMENT_PLANS: ReadonlyArray<Plan> = ['PAYROLL']

/** 주말·공휴일이면 다음 영업일로 미룹니다. 은행망 CMS는 비영업일에 출금하지 않습니다. */
export function nextBusinessDay(date: string, holidays: ReadonlySet<string>): string {
  let current = date
  while (weekdayIndex(current) === 0 || weekdayIndex(current) === 6 || holidays.has(current)) {
    current = addDays(current, 1)
  }
  return current
}

/** 그달(`YYYY-MM`)의 출금일입니다. {@link BILLING_DAY}에서 시작해 영업일로 미룹니다. */
export function billingDate(month: string, holidays: ReadonlySet<string>): string {
  return nextBusinessDay(`${month}-${String(BILLING_DAY).padStart(2, '0')}`, holidays)
}

/** 출금 결과가 반영되는 날입니다. CMS 결과 파일이 출금 다음 날 오후에 옵니다. */
export function resultExpectedOn(withdrawnOn: string): string {
  return addDays(withdrawnOn, 1)
}

/** 결제 예정 금액 알림톡을 보내는 날입니다. 출금일 하루 전입니다. */
export function noticeDate(withdrawalDate: string): string {
  return addDays(withdrawalDate, -1)
}

const TRANSITIONS: Record<PaymentStatus, Partial<Record<PaymentEvent, PaymentStatus>>> = {
  SCHEDULED: { WITHDRAWAL_SUCCEEDED: 'PAID', WITHDRAWAL_FAILED: 'FAILED' },
  FAILED: { RETRY: 'RETRYING' },
  RETRYING: { WITHDRAWAL_SUCCEEDED: 'PAID', WITHDRAWAL_FAILED: 'FAILED' },
  PAID: { REFUND: 'REFUNDED' },
  REFUNDED: {},
}

/** 사건이 일어난 뒤의 결제 상태입니다. 허용되지 않은 전이면 `undefined`입니다. */
export function paymentTransition(from: PaymentStatus, event: PaymentEvent): PaymentStatus | undefined {
  return TRANSITIONS[from][event]
}

/** 상태에서 담당자가 할 수 있는 커맨드입니다. */
export function allowedPaymentActions(status: PaymentStatus): PaymentAction[] {
  return (['RETRY', 'REFUND'] as const).filter((action) => paymentTransition(status, action) !== undefined)
}

/** 결제 내역에 보여 줄 상품인지입니다. */
export function isListedPayment(plan: Plan): boolean {
  return LISTED_PAYMENT_PLANS.includes(plan)
}

/**
 * 그달 만들 결제 예정입니다. 출금일에 플랜을 쓸 수 있고 월 이용료가 0보다 큰 구독마다 한 건을 만듭니다.
 *
 * 같은 구독·출금일의 결제가 이미 있으면 만들지 않으므로 작업을 여러 번 돌려도 한 건입니다.
 */
export function plannedPayments(input: {
  month: string
  subscriptions: ReadonlyArray<BillableSubscription>
  existing: ReadonlyArray<ScheduledKey>
  holidays: ReadonlySet<string>
}): PaymentPlanItem[] {
  const scheduledOn = billingDate(input.month, input.holidays)
  return input.subscriptions
    .filter((subscription) => subscription.monthlyFee > 0 && isEntitledOn(subscription, scheduledOn))
    .filter(
      (subscription) =>
        !input.existing.some(
          (key) => key.subscriptionId === subscription.subscriptionId && key.scheduledOn === scheduledOn,
        ),
    )
    .map((subscription) => ({
      subscriptionId: subscription.subscriptionId,
      plan: subscription.plan,
      amount: subscription.monthlyFee,
      scheduledOn,
    }))
}
