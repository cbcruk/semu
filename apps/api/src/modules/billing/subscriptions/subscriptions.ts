import { Clock, Context, Effect, Layer } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { hasPermission } from '../../identity-access/actor.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { nowIso, today } from '../billing-access.ts'
import {
  allowedSubscriptionCommands,
  isEntitledOn,
  refreshedStatus,
  subscriptionTransition,
} from './subscription-entitlement.ts'
import type { SubscriptionCommand } from './subscription-entitlement.types.ts'
import { ServiceContractRepository } from '../service-contracts/service-contract-repository.ts'
import { ServiceContractNotFound } from '../service-contracts/service-contract.ts'
import { SubscriptionRepository } from './subscription-repository.ts'
import {
  SubscriptionAlreadyExists,
  SubscriptionEndDateInvalid,
  SubscriptionNotFound,
  SubscriptionTransitionInvalid,
} from './subscription.ts'
import type { Subscription, SubscriptionId, SubscriptionRecord } from './subscription.ts'

/** 오늘 날짜로 상태를 다시 계산한 응답입니다. 대리인 전용 `subscription:manage`가 있을 때만 `allowedActions`를 채웁니다. */
export function toSubscription(record: SubscriptionRecord, actor: Actor, date: string): Subscription {
  const status = refreshedStatus(record, date)
  return {
    id: record.id,
    plan: record.plan,
    status,
    isEntitled: isEntitledOn(record, date),
    startsOn: record.startsOn,
    ...(record.endsOn === undefined ? {} : { endsOn: record.endsOn }),
    monthlyFee: record.monthlyFee,
    ...(record.serviceContractId === undefined ? {} : { serviceContractId: record.serviceContractId }),
    allowedActions: hasPermission(actor, 'subscription:manage') ? allowedSubscriptionCommands(status) : [],
    createdAt: record.createdAt,
    version: record.version,
  }
}

/** 구독 조회와 담당자의 구독 시작·해지 예약·해지 철회입니다. */
export class Subscriptions extends Context.Service<
  Subscriptions,
  {
    list(actor: Actor): Effect.Effect<Subscription[]>
    get(actor: Actor, subscriptionId: SubscriptionId): Effect.Effect<Subscription, SubscriptionNotFound>
    start(
      actor: Actor,
      input: {
        plan: SubscriptionRecord['plan']
        startsOn: string
        monthlyFee: number
        serviceContractId?: SubscriptionRecord['serviceContractId']
      },
    ): Effect.Effect<Subscription, SubscriptionAlreadyExists | ServiceContractNotFound>
    change(
      actor: Actor,
      subscriptionId: SubscriptionId,
      command: SubscriptionCommand,
      options: { endsOn?: string; expectedVersion?: number | undefined },
    ): Effect.Effect<
      Subscription,
      SubscriptionNotFound | SubscriptionTransitionInvalid | SubscriptionEndDateInvalid | VersionMismatch
    >
  }
>()('semu/billing/Subscriptions') {
  static readonly layer = Layer.effect(
    Subscriptions,
    Effect.gen(function* () {
      const repository = yield* SubscriptionRepository
      const contracts = yield* ServiceContractRepository

      const load = (actor: Actor, subscriptionId: SubscriptionId) =>
        repository.find(actor.companyId, subscriptionId).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new SubscriptionNotFound({})),
        )

      return Subscriptions.of({
        list: Effect.fn(function* (actor) {
          const date = yield* today
          const rows = yield* repository.listByCompany(actor.companyId)
          return rows.map((row) => toSubscription(row, actor, date))
        }),
        get: Effect.fn(function* (actor, subscriptionId) {
          const date = yield* today
          return toSubscription(yield* load(actor, subscriptionId), actor, date)
        }),
        start: Effect.fn(function* (actor, input) {
          const date = yield* today
          const rows = yield* repository.listByCompany(actor.companyId)
          const open = rows.find((row) => row.plan === input.plan && refreshedStatus(row, date) !== 'ENDED')
          if (open !== undefined) return yield* new SubscriptionAlreadyExists({ subscriptionId: open.id })
          // 다른 회사의 계약을 잇지 못하게 담당 회사 안에서만 찾습니다.
          if (input.serviceContractId !== undefined) {
            const contract = yield* contracts.find(actor.companyId, input.serviceContractId)
            if (contract._tag === 'None') return yield* new ServiceContractNotFound({})
          }
          const record: SubscriptionRecord = {
            id: newId('subscription', yield* Clock.currentTimeMillis),
            companyId: actor.companyId,
            plan: input.plan,
            status: input.startsOn > date ? 'PENDING' : 'ACTIVE',
            startsOn: input.startsOn,
            monthlyFee: input.monthlyFee,
            serviceContractId: input.serviceContractId,
            createdAt: yield* nowIso,
            version: 1,
          }
          yield* repository.save(record)
          return toSubscription(record, actor, date)
        }),
        change: Effect.fn(function* (actor, subscriptionId, command, options) {
          const date = yield* today
          const record = yield* load(actor, subscriptionId)
          yield* checkVersion(record.version, options.expectedVersion)
          const current = refreshedStatus(record, date)
          const next = subscriptionTransition(current, command)
          if (next === undefined) return yield* new SubscriptionTransitionInvalid({ currentStatus: current })
          const endsOn = command === 'RESUME' ? undefined : next === 'ENDED' ? record.endsOn : (options.endsOn ?? date)
          if (
            next === 'CANCELLATION_SCHEDULED' &&
            endsOn !== undefined &&
            (endsOn < date || endsOn < record.startsOn)
          ) {
            return yield* new SubscriptionEndDateInvalid({})
          }
          const updated: SubscriptionRecord = { ...record, status: next, endsOn, version: record.version + 1 }
          yield* repository.save(updated)
          return toSubscription(updated, actor, date)
        }),
      })
    }),
  )
}
