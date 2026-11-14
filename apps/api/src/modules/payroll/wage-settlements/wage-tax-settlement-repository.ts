import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { WageTaxSettlementRecord } from './wage-tax-settlement.types.ts'

/** 근로소득 정산(중도퇴사·연말정산) 저장소입니다. */
export class WageTaxSettlementRepository extends Context.Service<
  WageTaxSettlementRepository,
  {
    /** 회사의 정산입니다. 과세연도, 직원 이름, ID 순입니다. */
    list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<WageTaxSettlementRecord>>
    find(companyId: Id<'company'>, id: Id<'wageTaxSettlement'>): Effect.Effect<Option.Option<WageTaxSettlementRecord>>
    save(record: WageTaxSettlementRecord): Effect.Effect<void>
    remove(companyId: Id<'company'>, id: Id<'wageTaxSettlement'>): Effect.Effect<void>
  }
>()('semu/payroll/WageTaxSettlementRepository') {
  /** `payroll_wage_tax_settlements` 표에 둡니다. */
  static readonly layer = (seed: ReadonlyArray<WageTaxSettlementRecord> = []) =>
    Layer.effect(
      WageTaxSettlementRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<WageTaxSettlementRecord>('payroll_wage_tax_settlements', {
          seed,
          companyOf: (record) => record.companyId,
        })
        return WageTaxSettlementRepository.of({
          list: (companyId) =>
            Effect.map(table.byCompany(companyId), (records) =>
              records.toSorted(
                (a, b) =>
                  a.year.localeCompare(b.year) ||
                  a.employeeName.localeCompare(b.employeeName) ||
                  a.id.localeCompare(b.id),
              ),
            ),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((record) => record.companyId === companyId),
            ),
          save: (record) => table.put(record),
          remove: (companyId, id) =>
            Effect.flatMap(table.get(id), (found) =>
              Option.isSome(found) && found.value.companyId === companyId ? table.remove(id) : Effect.void,
            ),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = WageTaxSettlementRepository.layer().pipe(Layer.provide(TableFactory.layerMemory))
}
