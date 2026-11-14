import { addDays, addMonths, weekdayIndex } from '../../../shared/time/calendar.ts'
import type { Plan } from '../../identity-access/actor.types.ts'
import { isEntitledOn } from '../subscriptions/subscription-entitlement.ts'
import type {
  BillableSubscription,
  PaymentAction,
  PaymentEvent,
  PaymentPlanItem,
  PaymentStatus,
  ScheduledKey,
  ScheduledPaymentAdjustment,
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

/** 결제 예정을 만드는 날은 출금일 이 날수 전부터 전날까지입니다. 출금 하루 전 알림톡보다 앞서야 합니다. */
export const SCHEDULE_LEAD_DAYS = 3

/**
 * `today`(회사 시간대)에 결제 예정을 만들 달입니다. 그달 출금일의 {@link SCHEDULE_LEAD_DAYS}일 전부터 전날까지면 그 달이고, 아니면
 * `null`입니다. 출금일 당일에는 이미 CMS 요청이 나갔다고 보고 만들지 않습니다.
 *
 * 만든 뒤의 구독 해지·출금 계좌 변경은 {@link adjustScheduledPayment}로 다시 맞춥니다. 출금일이 공휴일로 다음 달로 넘어갈 수 있어 지난달 출금일도 봅니다.
 */
export function schedulingMonthOn(today: string, holidays: ReadonlySet<string>): string | null {
  const 이번달 = today.slice(0, 7)
  for (const 달 of [addMonths(이번달, -1), 이번달]) {
    const 출금일 = billingDate(달, holidays)
    if (addDays(출금일, -SCHEDULE_LEAD_DAYS) <= today && today < 출금일) return 달
  }
  return null
}

/** 출금 결과가 반영되는 날입니다. CMS 결과 파일이 출금 다음 날 오후에 옵니다. */
export function resultExpectedOn(withdrawnOn: string): string {
  return addDays(withdrawnOn, 1)
}

/** 결제 예정 금액 알림톡을 보내는 날입니다. 출금일 하루 전입니다. */
export function noticeDate(withdrawalDate: string): string {
  return addDays(withdrawalDate, -1)
}

const 결제상태전이표: Record<PaymentStatus, Partial<Record<PaymentEvent, PaymentStatus>>> = {
  SCHEDULED: { WITHDRAWAL_SUCCEEDED: 'PAID', WITHDRAWAL_FAILED: 'FAILED', CANCEL: 'CANCELED' },
  FAILED: { RETRY: 'RETRYING' },
  RETRYING: { WITHDRAWAL_SUCCEEDED: 'PAID', WITHDRAWAL_FAILED: 'FAILED' },
  PAID: { REFUND: 'REFUNDED' },
  REFUNDED: {},
  CANCELED: {},
}

/** 사건이 일어난 뒤의 결제 상태입니다. 허용되지 않은 전이면 `undefined`입니다. */
export function paymentTransition(from: PaymentStatus, event: PaymentEvent): PaymentStatus | undefined {
  return 결제상태전이표[from][event]
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
  const 출금일 = billingDate(input.month, input.holidays)
  return input.subscriptions
    .filter((subscription) => subscription.monthlyFee > 0 && isEntitledOn(subscription, 출금일))
    .filter(
      (subscription) =>
        !input.existing.some((key) => key.subscriptionId === subscription.subscriptionId && key.scheduledOn === 출금일),
    )
    .map((subscription) => ({
      subscriptionId: subscription.subscriptionId,
      plan: subscription.plan,
      amount: subscription.monthlyFee,
      scheduledOn: 출금일,
    }))
}

/**
 * 이미 만든 결제 예정 하나를 지금 구독·출금 동의에 맞춥니다.
 *
 * - `SCHEDULED`가 아니거나 출금일이 오늘이거나 지났으면 그대로 둡니다. 출금일 당일에는 이미 CMS 요청이 나갔다고 봅니다
 * - 구독이 없거나, 월 이용료가 0이거나, 출금일에 플랜을 쓸 수 없으면(해지 종료일이 출금일 전) 취소합니다
 * - 금액이 지금 월 이용료와 다르거나 출금 계좌가 지금 `REGISTERED` 동의와 다르면 고칩니다. 동의가 없어졌으면 계좌를 비웁니다
 */
export function adjustScheduledPayment(input: {
  payment: { status: PaymentStatus; scheduledOn: string; amount: number; mandateId?: string | undefined }
  subscription: BillableSubscription | undefined
  registeredMandateId: string | undefined
  today: string
}): ScheduledPaymentAdjustment {
  const { payment, subscription } = input
  if (payment.status !== 'SCHEDULED' || payment.scheduledOn <= input.today) return { kind: 'KEEP' }
  if (subscription === undefined || subscription.monthlyFee <= 0 || !isEntitledOn(subscription, payment.scheduledOn)) {
    return { kind: 'CANCEL' }
  }
  if (payment.amount === subscription.monthlyFee && payment.mandateId === input.registeredMandateId) {
    return { kind: 'KEEP' }
  }
  return { kind: 'UPDATE', amount: subscription.monthlyFee, mandateId: input.registeredMandateId }
}
