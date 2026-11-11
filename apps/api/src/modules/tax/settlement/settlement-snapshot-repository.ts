import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ProfitLossSnapshotRecord } from './settlement-report.types.ts'

/** 표에 저장하는 손익 스냅샷 한 건입니다. 회사·사업연도마다 한 건이라 ID는 `회사ID:사업연도`입니다. */
interface StoredProfitLossSnapshot {
  id: string
  snapshot: ProfitLossSnapshotRecord
}

function snapshotId(companyId: Id<'company'>, fiscalYear: number): string {
  return `${companyId}:${fiscalYear}`
}

/** 담당자가 올린 결산 스냅샷 저장소입니다. 지금은 손익 스냅샷만 둡니다. */
export class SettlementSnapshotRepository extends Context.Service<
  SettlementSnapshotRepository,
  {
    findProfitLoss(companyId: Id<'company'>, fiscalYear: number): Effect.Effect<Option.Option<ProfitLossSnapshotRecord>>
    /** 회사의 손익 스냅샷 전체입니다. 사업연도 내림차순입니다. */
    listProfitLoss(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<ProfitLossSnapshotRecord>>
    /** 같은 회사·사업연도의 스냅샷을 통째로 바꿉니다. */
    saveProfitLoss(snapshot: ProfitLossSnapshotRecord): Effect.Effect<void>
  }
>()('semu/tax/SettlementSnapshotRepository') {
  /** `tax_settlement_profit_loss` 표에 둡니다. `seed`는 처음 넣을 스냅샷입니다. */
  static readonly layer = (seed: ReadonlyArray<ProfitLossSnapshotRecord> = []) =>
    Layer.effect(
      SettlementSnapshotRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<StoredProfitLossSnapshot>('tax_settlement_profit_loss', {
          seed: seed.map((snapshot) => ({ id: snapshotId(snapshot.companyId, snapshot.fiscalYear), snapshot })),
          companyOf: (record) => record.snapshot.companyId,
        })
        return SettlementSnapshotRepository.of({
          findProfitLoss: (companyId, fiscalYear) =>
            Effect.map(table.get(snapshotId(companyId, fiscalYear)), (found) =>
              Option.filter(
                Option.map(found, (record) => record.snapshot),
                (snapshot) => snapshot.companyId === companyId,
              ),
            ),
          listProfitLoss: (companyId) =>
            Effect.map(table.byCompany(companyId), (records) =>
              records.map((record) => record.snapshot).toSorted((a, b) => b.fiscalYear - a.fiscalYear),
            ),
          saveProfitLoss: (snapshot) =>
            table.put({ id: snapshotId(snapshot.companyId, snapshot.fiscalYear), snapshot }),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ProfitLossSnapshotRecord> = []) =>
    SettlementSnapshotRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
