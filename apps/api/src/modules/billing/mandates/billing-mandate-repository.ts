import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `billing_mandates` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<BillingMandateRecord> = []) =>
    Layer.effect(
      BillingMandateRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<BillingMandateRecord>('billing_mandates', {
          seed,
          companyOf: (row) => row.companyId,
        })
        return BillingMandateRepository.of({
          find: (mandateId) => table.get(mandateId),
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (rows) =>
              rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
            ),
          save: (mandate) => table.put(mandate),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 출금 동의를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BillingMandateRecord> = []) =>
    BillingMandateRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
