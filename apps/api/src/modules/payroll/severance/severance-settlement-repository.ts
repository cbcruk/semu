import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `payroll_severance_settlements` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<SeveranceSettlementRecord> = []) =>
    Layer.effect(
      SeveranceSettlementRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<SeveranceSettlementRecord>('payroll_severance_settlements', {
          seed,
          companyOf: (record) => record.companyId,
        })
        return SeveranceSettlementRepository.of({
          list: (companyId) =>
            Effect.map(table.byCompany(companyId), (records) =>
              records.toSorted((a, b) => a.lastWorkDate.localeCompare(b.lastWorkDate) || a.id.localeCompare(b.id)),
            ),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((record) => record.companyId === companyId),
            ),
          save: (record) => table.put(record),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = SeveranceSettlementRepository.layer().pipe(Layer.provide(TableFactory.layerMemory))
}
