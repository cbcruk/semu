import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SeveranceSettlementRecord } from './severance-settlement.types.ts'

/** 퇴직금 정산 저장소입니다. */
export class SeveranceSettlementRepository extends Context.Service<
  SeveranceSettlementRepository,
  {
    list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<SeveranceSettlementRecord>>
    find(
      companyId: Id<'company'>,
      id: Id<'severanceSettlement'>,
    ): Effect.Effect<Option.Option<SeveranceSettlementRecord>>
    save(record: SeveranceSettlementRecord): Effect.Effect<void>
  }
>()('semu/payroll/SeveranceSettlementRepository') {
  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = Layer.effect(
    SeveranceSettlementRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(new Map<string, SeveranceSettlementRecord>())
      return SeveranceSettlementRepository.of({
        list: (companyId) =>
          Ref.get(store).pipe(
            Effect.map((map) =>
              [...map.values()]
                .filter((record) => record.companyId === companyId)
                .sort((a, b) => a.lastWorkDate.localeCompare(b.lastWorkDate) || a.id.localeCompare(b.id)),
            ),
          ),
        find: (companyId, id) =>
          Ref.get(store).pipe(
            Effect.map((map) =>
              Option.fromNullishOr(map.get(id)).pipe(Option.filter((record) => record.companyId === companyId)),
            ),
          ),
        save: (record) => Ref.update(store, (map) => new Map(map).set(record.id, record)),
      })
    }),
  )
}
