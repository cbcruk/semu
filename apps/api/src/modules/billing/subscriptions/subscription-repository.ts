import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** `seed`로 시작해 프로세스 메모리에 구독을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SubscriptionRecord> = []) =>
    Layer.effect(
      SubscriptionRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((row) => [row.id, row])))
        const sorted = (rows: Iterable<SubscriptionRecord>): SubscriptionRecord[] =>
          [...rows].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id))
        return SubscriptionRepository.of({
          find: (companyId, subscriptionId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                Option.filter(Option.fromNullishOr(rows.get(subscriptionId)), (row) => row.companyId === companyId),
              ),
            ),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((rows) => sorted([...rows.values()].filter((row) => row.companyId === companyId))),
            ),
          listAll: () => Ref.get(store).pipe(Effect.map((rows) => sorted(rows.values()))),
          save: (subscription) => Ref.update(store, (rows) => new Map(rows).set(subscription.id, subscription)),
        })
      }),
    )
}
