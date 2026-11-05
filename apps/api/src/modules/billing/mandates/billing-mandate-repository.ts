import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { BillingMandateId, BillingMandateRecord } from './billing-mandate.ts'

/** CMS 출금 동의 저장소입니다. */
export class BillingMandateRepository extends Context.Service<
  BillingMandateRepository,
  {
    find(mandateId: BillingMandateId): Effect.Effect<Option.Option<BillingMandateRecord>>
    /** 회사의 출금 동의를 최신순으로 돌려줍니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<BillingMandateRecord[]>
    save(mandate: BillingMandateRecord): Effect.Effect<void>
  }
>()('semu/billing/BillingMandateRepository') {
  /** `seed`로 시작해 프로세스 메모리에 출금 동의를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BillingMandateRecord> = []) =>
    Layer.effect(
      BillingMandateRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((row) => [row.id, row])))
        return BillingMandateRepository.of({
          find: (mandateId) => Ref.get(store).pipe(Effect.map((rows) => Option.fromNullishOr(rows.get(mandateId)))),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                [...rows.values()]
                  .filter((row) => row.companyId === companyId)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
              ),
            ),
          save: (mandate) => Ref.update(store, (rows) => new Map(rows).set(mandate.id, mandate)),
        })
      }),
    )
}
