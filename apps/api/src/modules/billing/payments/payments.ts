import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { runIdempotent } from '../../../shared/http/idempotency.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type {
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { hasPermission } from '../../identity-access/actor.ts'
import type { Actor, Permission } from '../../identity-access/actor.types.ts'
import { nowIso, today } from '../billing-access.ts'
import { BillingIdempotency } from '../billing-idempotency.ts'
import { BillingMandateRepository } from '../mandates/billing-mandate-repository.ts'
import type { BillingMandateRecord } from '../mandates/billing-mandate.ts'
import { SubscriptionRepository } from '../subscriptions/subscription-repository.ts'
import { PaymentRepository } from './payment-repository.ts'
import {
  adjustScheduledPayment,
  allowedPaymentActions,
  isListedPayment,
  nextBusinessDay,
  paymentTransition,
  plannedPayments,
  resultExpectedOn,
  schedulingMonthOn,
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
    ...(record.canceledAt === undefined ? {} : { canceledAt: record.canceledAt }),
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

type IdempotencyProblem = IdempotencyKeyRequired | IdempotencyKeyReused | IdempotencyKeyInProgress

/** CMS 결과 파일 한 줄입니다. */
export interface WithdrawalResult {
  succeeded: boolean
  failureReason?: PaymentFailureReason
}

/** {@link Payments.reconcile}의 결과입니다. */
export interface PaymentReconciliation {
  /** 결제 예정을 만드는 기간이면 그 달, 아니면 `null`입니다. */
  month: string | null
  created: PaymentRecord[]
  canceled: PaymentRecord[]
  updated: PaymentRecord[]
}

/**
 * 결제 내역 조회, 담당자의 재시도·환불, 그리고 HTTP로 열지 않는 작업(월 정기결제 예정 생성·다시 맞추기, 출금 결과 반영)입니다.
 *
 * 작업은 스케줄러와 구독·출금 동의 서비스, CMS 결과 파일 수신기가 부릅니다. 모두 여러 번 불러도 결과가 같습니다.
 */
export class Payments extends Context.Service<
  Payments,
  {
    list(actor: Actor, query: PageQuery & { status?: PaymentStatus }): Effect.Effect<PageOf<Payment>>
    get(actor: Actor, paymentId: PaymentId): Effect.Effect<Payment, PaymentNotFound>
    /**
     * 실패한 결제를 다시 출금하게 합니다. `Idempotency-Key`는 회사·행위자마다 따로이고, 같은 키·같은 결제·같은 본문으로 24시간 안에 다시
     * 오면 처음 응답을 돌려줍니다(`If-Match`는 다시 보지 않습니다). 실패한 요청은 키를 남기지 않습니다.
     */
    retry(
      actor: Actor,
      paymentId: PaymentId,
      options: { retryOn?: string; expectedVersion?: number | undefined; idempotencyKey: string | undefined },
    ): Effect.Effect<
      Payment,
      PaymentNotFound | PaymentTransitionInvalid | RetryDateInvalid | VersionMismatch | IdempotencyProblem
    >
    /** 완료된 결제를 환불합니다. `Idempotency-Key`는 {@link retry}와 같습니다. */
    refund(
      actor: Actor,
      paymentId: PaymentId,
      options: { expectedVersion?: number | undefined; idempotencyKey: string | undefined },
    ): Effect.Effect<Payment, PaymentNotFound | PaymentTransitionInvalid | VersionMismatch | IdempotencyProblem>
    /** 그달 결제 예정을 만듭니다. 이미 있는 구독·출금일(취소한 것은 빼고)은 건너뛰고 새로 만든 결제를 돌려줍니다. */
    scheduleMonth(month: string): Effect.Effect<PaymentRecord[]>
    /**
     * 결제 예정을 오늘(`today`, 회사 시간대)의 구독·출금 동의에 다시 맞춥니다. `companyId`가 있으면 그 회사만 봅니다.
     *
     * 출금일이 오지 않은 `SCHEDULED` 결제는 자격이 없어졌으면 취소하고 금액·출금 계좌를 고칩니다({@link adjustScheduledPayment}).
     * 오늘이 결제 예정을 만드는 기간이면({@link schedulingMonthOn}) 빠진 결제 예정도 만듭니다. 해지를 되돌린 구독이 그렇습니다.
     */
    reconcile(today: string, companyId?: Id<'company'>): Effect.Effect<PaymentReconciliation>
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
      const idempotency = yield* BillingIdempotency

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

      const registeredMandate = (companyId: Id<'company'>) =>
        mandates.listByCompany(companyId).pipe(Effect.map((rows) => rows.find((row) => row.status === 'REGISTERED')))

      /** 그달 빠진 결제 예정을 만듭니다. 취소한 결제는 막지 않으므로 해지를 되돌린 구독은 다시 만듭니다. */
      const createScheduled = Effect.fn('Payments.createScheduled')(function* (
        month: string,
        companyId: Id<'company'> | undefined,
      ) {
        const rows = (yield* subscriptions.listAll()).filter(
          (row) => companyId === undefined || row.companyId === companyId,
        )
        const existing = (yield* payments.listAll()).filter((row) => row.status !== 'CANCELED')
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
          const mandate = yield* registeredMandate(subscription.companyId)
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
      })

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
        retry: (actor, paymentId, options) =>
          runIdempotent(
            {
              store: idempotency,
              companyId: actor.companyId,
              actorUserId: actor.userId,
              key: options.idempotencyKey,
              operation: 'payment.retry',
              request: { paymentId, retryOn: options.retryOn },
            },
            () =>
              Effect.gen(function* () {
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
          ),
        refund: (actor, paymentId, options) =>
          runIdempotent(
            {
              store: idempotency,
              companyId: actor.companyId,
              actorUserId: actor.userId,
              key: options.idempotencyKey,
              operation: 'payment.refund',
              request: { paymentId },
            },
            () =>
              Effect.gen(function* () {
                const record = yield* load(actor, paymentId)
                yield* checkVersion(record.version, options.expectedVersion)
                const status = yield* transition(record, 'REFUND')
                const updated: PaymentRecord = {
                  ...record,
                  status,
                  refundedAt: yield* nowIso,
                  version: record.version + 1,
                }
                yield* payments.save(updated)
                return yield* view(updated, actor)
              }),
          ),
        scheduleMonth: (month) => createScheduled(month, undefined),
        reconcile: Effect.fn(function* (date, companyId) {
          const calendar = yield* holidays.all()
          const inScope = <T extends { companyId: Id<'company'> }>(rows: ReadonlyArray<T>) =>
            companyId === undefined ? rows : rows.filter((row) => row.companyId === companyId)
          const rows = inScope(yield* subscriptions.listAll())
          const scheduled = inScope(yield* payments.listAll()).filter((row) => row.status === 'SCHEDULED')
          const at = yield* nowIso
          const canceled: PaymentRecord[] = []
          const updated: PaymentRecord[] = []
          for (const payment of scheduled) {
            const subscription = rows.find((row) => row.id === payment.subscriptionId)
            const adjustment = adjustScheduledPayment({
              payment,
              subscription:
                subscription === undefined ? undefined : { ...subscription, subscriptionId: subscription.id },
              registeredMandateId: (yield* registeredMandate(payment.companyId))?.id,
              today: date,
            })
            if (adjustment.kind === 'KEEP') continue
            if (adjustment.kind === 'CANCEL') {
              const record: PaymentRecord = {
                ...payment,
                status: 'CANCELED',
                canceledAt: at,
                version: payment.version + 1,
              }
              yield* payments.save(record)
              canceled.push(record)
              continue
            }
            const record: PaymentRecord = {
              ...payment,
              amount: adjustment.amount,
              mandateId: adjustment.mandateId as Id<'billingMandate'> | undefined,
              version: payment.version + 1,
            }
            yield* payments.save(record)
            updated.push(record)
          }
          const month = schedulingMonthOn(date, calendar)
          const created = month === null ? [] : yield* createScheduled(month, companyId)
          return { month, created, canceled, updated }
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
