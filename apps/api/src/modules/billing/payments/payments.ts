import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { hasPermission } from '../../identity-access/actor.ts'
import type { Actor, Permission } from '../../identity-access/actor.types.ts'
import { nowIso, today } from '../billing-access.ts'
import { BillingMandateRepository } from '../mandates/billing-mandate-repository.ts'
import type { BillingMandateRecord } from '../mandates/billing-mandate.ts'
import { SubscriptionRepository } from '../subscriptions/subscription-repository.ts'
import { PaymentRepository } from './payment-repository.ts'
import {
  allowedPaymentActions,
  isListedPayment,
  nextBusinessDay,
  paymentTransition,
  plannedPayments,
  resultExpectedOn,
} from './payment-schedule.ts'
import type { PaymentAction, PaymentEvent, PaymentStatus } from './payment-schedule.types.ts'
import { PaymentNotFound, PaymentTransitionInvalid, RetryDateInvalid } from './payment.ts'
import type { Payment, PaymentFailureReason, PaymentId, PaymentRecord } from './payment.ts'
import { PublicHolidays } from './public-holidays.ts'

/** 저장한 결제를 응답 형태로 바꿉니다. `allowedActions`에는 행위자가 가진 대리인 전용 권한(`payment:retry`·`payment:refund`)의 커맨드만 넣습니다. */
export function toPayment(record: PaymentRecord, actor: Actor, mandate: BillingMandateRecord | undefined): Payment {
  const waiting = record.status === 'SCHEDULED' || record.status === 'RETRYING'
  return {
    id: record.id,
    number: record.number,
    plan: record.plan,
    amount: record.amount,
    scheduledOn: record.scheduledOn,
    status: record.status,
    ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
    ...(waiting ? { resultExpectedOn: resultExpectedOn(record.scheduledOn) } : {}),
    ...(mandate === undefined
      ? {}
      : { account: { bankCode: mandate.bankCode, accountNumberMasked: mandate.accountNumberMasked } }),
    ...(record.settledAt === undefined ? {} : { settledAt: record.settledAt }),
    ...(record.refundedAt === undefined ? {} : { refundedAt: record.refundedAt }),
    allowedActions: allowedPaymentActions(record.status).filter((action) =>
      hasPermission(actor, PAYMENT_ACTION_PERMISSION[action]),
    ),
    version: record.version,
  }
}

/** 결제 커맨드별 권한입니다. 둘 다 대리인 전용이라 고객 관리자의 `*`로는 생기지 않습니다. */
const PAYMENT_ACTION_PERMISSION: Record<PaymentAction, Permission> = {
  RETRY: 'payment:retry',
  REFUND: 'payment:refund',
}

/** 출금일 최신순, 같으면 번호 큰 순으로 커서가 이어지도록 오름차순 문자열 키를 만듭니다. */
function pageKey(row: PaymentRecord): string {
  const date = 99991231 - Number(row.scheduledOn.replaceAll('-', ''))
  return `${String(date).padStart(8, '0')}:${String(999_999_999 - row.number).padStart(9, '0')}`
}

/** CMS 결과 파일 한 줄입니다. */
export interface WithdrawalResult {
  succeeded: boolean
  failureReason?: PaymentFailureReason
}

/**
 * 결제 내역 조회, 담당자의 재시도·환불, 그리고 HTTP로 열지 않는 작업(월 정기결제 예정 생성, 출금 결과 반영)입니다.
 *
 * 작업 두 개는 스케줄러와 CMS 결과 파일 수신기가 부릅니다. 둘 다 여러 번 불러도 결과가 같습니다.
 */
export class Payments extends Context.Service<
  Payments,
  {
    list(actor: Actor, query: PageQuery & { status?: PaymentStatus }): Effect.Effect<PageOf<Payment>>
    get(actor: Actor, paymentId: PaymentId): Effect.Effect<Payment, PaymentNotFound>
    retry(
      actor: Actor,
      paymentId: PaymentId,
      options: { retryOn?: string; expectedVersion?: number | undefined },
    ): Effect.Effect<Payment, PaymentNotFound | PaymentTransitionInvalid | RetryDateInvalid | VersionMismatch>
    refund(
      actor: Actor,
      paymentId: PaymentId,
      options: { expectedVersion?: number | undefined },
    ): Effect.Effect<Payment, PaymentNotFound | PaymentTransitionInvalid | VersionMismatch>
    /** 그달 결제 예정을 만듭니다. 이미 있는 구독·출금일은 건너뛰고 새로 만든 결제를 돌려줍니다. */
    scheduleMonth(month: string): Effect.Effect<PaymentRecord[]>
    /** CMS 결과를 반영합니다. 이미 반영된 결제(완료·실패)에 같은 결과가 다시 오면 그대로 둡니다. */
    recordWithdrawal(paymentId: PaymentId, result: WithdrawalResult): Effect.Effect<Option.Option<PaymentRecord>>
  }
>()('semu/billing/Payments') {
  static readonly layer = Layer.effect(
    Payments,
    Effect.gen(function* () {
      const payments = yield* PaymentRepository
      const subscriptions = yield* SubscriptionRepository
      const mandates = yield* BillingMandateRepository
      const holidays = yield* PublicHolidays

      const mandateOf = (record: PaymentRecord) =>
        record.mandateId === undefined
          ? Effect.succeed(undefined)
          : mandates.find(record.mandateId).pipe(Effect.map(Option.getOrUndefined))

      const view = (record: PaymentRecord, actor: Actor) =>
        Effect.map(mandateOf(record), (mandate) => toPayment(record, actor, mandate))

      const load = (actor: Actor, paymentId: PaymentId) =>
        payments.find(actor.companyId, paymentId).pipe(
          Effect.map(Option.filter((row) => isListedPayment(row.plan))),
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new PaymentNotFound({})),
        )

      const transition = (record: PaymentRecord, event: PaymentEvent) => {
        const next = paymentTransition(record.status, event)
        return next === undefined
          ? Effect.fail(new PaymentTransitionInvalid({ currentStatus: record.status }))
          : Effect.succeed(next)
      }

      return Payments.of({
        list: Effect.fn(function* (actor, query) {
          const rows = (yield* payments.listByCompany(actor.companyId)).filter(
            (row) => isListedPayment(row.plan) && (query.status === undefined || row.status === query.status),
          )
          const page = paginate(rows, pageKey, query)
          return { ...page, items: yield* Effect.forEach(page.items, (row) => view(row, actor)) }
        }),
        get: Effect.fn(function* (actor, paymentId) {
          return yield* view(yield* load(actor, paymentId), actor)
        }),
        retry: Effect.fn(function* (actor, paymentId, options) {
          const record = yield* load(actor, paymentId)
          yield* checkVersion(record.version, options.expectedVersion)
          const status = yield* transition(record, 'RETRY')
          const date = yield* today
          if (options.retryOn !== undefined && options.retryOn < date) return yield* new RetryDateInvalid({})
          const calendar = yield* holidays.all()
          const scheduledOn = nextBusinessDay(options.retryOn ?? addDays(date, 1), calendar)
          const { failureReason: _, ...rest } = record
          const updated: PaymentRecord = { ...rest, status, scheduledOn, version: record.version + 1 }
          yield* payments.save(updated)
          return yield* view(updated, actor)
        }),
        refund: Effect.fn(function* (actor, paymentId, options) {
          const record = yield* load(actor, paymentId)
          yield* checkVersion(record.version, options.expectedVersion)
          const status = yield* transition(record, 'REFUND')
          const updated: PaymentRecord = { ...record, status, refundedAt: yield* nowIso, version: record.version + 1 }
          yield* payments.save(updated)
          return yield* view(updated, actor)
        }),
        scheduleMonth: Effect.fn(function* (month) {
          const rows = yield* subscriptions.listAll()
          const existing = yield* payments.listAll()
          const items = plannedPayments({
            month,
            subscriptions: rows.map((row) => ({ ...row, subscriptionId: row.id })),
            existing: existing.map((row) => ({ subscriptionId: row.subscriptionId, scheduledOn: row.scheduledOn })),
            holidays: yield* holidays.all(),
          })
          const createdAt = yield* nowIso
          const created: PaymentRecord[] = []
          for (const item of items) {
            const subscription = rows.find((row) => row.id === item.subscriptionId)
            if (subscription === undefined) continue
            const mandate = (yield* mandates.listByCompany(subscription.companyId)).find(
              (row) => row.status === 'REGISTERED',
            )
            const record: PaymentRecord = {
              id: newId('payment', yield* Clock.currentTimeMillis),
              number: yield* payments.nextNumber(),
              companyId: subscription.companyId,
              subscriptionId: subscription.id,
              plan: item.plan,
              amount: item.amount,
              scheduledOn: item.scheduledOn,
              status: 'SCHEDULED',
              mandateId: mandate?.id,
              createdAt,
              version: 1,
            }
            yield* payments.save(record)
            created.push(record)
          }
          return created
        }),
        recordWithdrawal: Effect.fn(function* (paymentId, result) {
          const record = (yield* payments.listAll()).find((row) => row.id === paymentId)
          if (record === undefined) return Option.none()
          const next = paymentTransition(record.status, result.succeeded ? 'WITHDRAWAL_SUCCEEDED' : 'WITHDRAWAL_FAILED')
          if (next === undefined) return Option.some(record)
          const updated: PaymentRecord = result.succeeded
            ? { ...record, status: next, settledAt: yield* nowIso, version: record.version + 1 }
            : { ...record, status: next, failureReason: result.failureReason ?? 'OTHER', version: record.version + 1 }
          yield* payments.save(updated)
          return Option.some(updated)
        }),
      })
    }),
  )
}
