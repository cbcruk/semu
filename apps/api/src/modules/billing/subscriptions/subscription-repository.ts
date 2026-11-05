import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SubscriptionId, SubscriptionRecord } from './subscription.ts'

/** 구독 저장소입니다. */
export class SubscriptionRepository extends Context.Service<
  SubscriptionRepository,
  {
    find(companyId: Id<'company'>, subscriptionId: SubscriptionId): Effect.Effect<Option.Option<SubscriptionRecord>>
    /** 회사의 구독을 시작일 순으로 돌려줍니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<SubscriptionRecord[]>
    /** 모든 회사의 구독입니다. 월 정기결제 작업이 씁니다. */
    listAll(): Effect.Effect<SubscriptionRecord[]>
    save(subscription: SubscriptionRecord): Effect.Effect<void>
  }
>()('semu/billing/SubscriptionRepository') {
  /** `billing_subscriptions` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<SubscriptionRecord> = []) =>
    Layer.effect(
      SubscriptionRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<SubscriptionRecord>('billing_subscriptions', {
          seed,
          companyOf: (row) => row.companyId,
        })
        const sorted = (rows: ReadonlyArray<SubscriptionRecord>): SubscriptionRecord[] =>
          rows.toSorted((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id))
        return SubscriptionRepository.of({
          find: (companyId, subscriptionId) =>
            Effect.map(
              table.get(subscriptionId),
              Option.filter((row) => row.companyId === companyId),
            ),
          listByCompany: (companyId) => Effect.map(table.byCompany(companyId), sorted),
          listAll: () => Effect.map(table.all(), sorted),
          save: (subscription) => table.put(subscription),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 구독을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SubscriptionRecord> = []) =>
    SubscriptionRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
