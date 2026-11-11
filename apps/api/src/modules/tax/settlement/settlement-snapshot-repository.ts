import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type {
  BalanceSheetSnapshotRecord,
  CashFlowSnapshotRecord,
  ProfitLossSnapshotRecord,
  ReceivablePayableSnapshotRecord,
} from './settlement-report.types.ts'

/** 모든 결산 스냅샷이 갖는 키입니다. */
interface SnapshotKey {
  companyId: Id<'company'>
  fiscalYear: number
}

/** 결산 보고서 한 종류의 스냅샷 저장소입니다. 회사·사업연도마다 한 건입니다. */
export interface SnapshotStore<T extends SnapshotKey> {
  find(companyId: Id<'company'>, fiscalYear: number): Effect.Effect<Option.Option<T>>
  /** 회사의 스냅샷 전체입니다. 사업연도 내림차순입니다. */
  list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<T>>
  /** 같은 회사·사업연도의 스냅샷을 통째로 바꿉니다. */
  save(snapshot: T): Effect.Effect<void>
}

/** 표에 저장하는 스냅샷 한 건입니다. ID는 `회사ID:사업연도`입니다. */
interface StoredSnapshot<T> {
  id: string
  snapshot: T
}

function snapshotId(companyId: Id<'company'>, fiscalYear: number): string {
  return `${companyId}:${fiscalYear}`
}

const makeStore = <T extends SnapshotKey>(
  name: string,
  seed: ReadonlyArray<T>,
): Effect.Effect<SnapshotStore<T>, never, TableFactory> =>
  Effect.gen(function* () {
    const table = yield* (yield* TableFactory).make<StoredSnapshot<T>>(name, {
      seed: seed.map((snapshot) => ({ id: snapshotId(snapshot.companyId, snapshot.fiscalYear), snapshot })),
      companyOf: (record) => record.snapshot.companyId,
    })
    return {
      find: (companyId, fiscalYear) =>
        Effect.map(table.get(snapshotId(companyId, fiscalYear)), (found) =>
          Option.filter(
            Option.map(found, (record) => record.snapshot),
            (snapshot) => snapshot.companyId === companyId,
          ),
        ),
      list: (companyId) =>
        Effect.map(table.byCompany(companyId), (records) =>
          records.map((record) => record.snapshot).toSorted((a, b) => b.fiscalYear - a.fiscalYear),
        ),
      save: (snapshot) => table.put({ id: snapshotId(snapshot.companyId, snapshot.fiscalYear), snapshot }),
    }
  })

/** {@link SettlementSnapshotRepository}의 시작 데이터입니다. */
export interface SettlementSnapshotSeed {
  profitLoss?: ReadonlyArray<ProfitLossSnapshotRecord>
  cashFlow?: ReadonlyArray<CashFlowSnapshotRecord>
  balanceSheet?: ReadonlyArray<BalanceSheetSnapshotRecord>
  receivablePayable?: ReadonlyArray<ReceivablePayableSnapshotRecord>
}

/** 담당자가 올린 결산 스냅샷 저장소입니다. 보고서 종류마다 표 하나입니다. */
export class SettlementSnapshotRepository extends Context.Service<
  SettlementSnapshotRepository,
  {
    profitLoss: SnapshotStore<ProfitLossSnapshotRecord>
    cashFlow: SnapshotStore<CashFlowSnapshotRecord>
    balanceSheet: SnapshotStore<BalanceSheetSnapshotRecord>
    receivablePayable: SnapshotStore<ReceivablePayableSnapshotRecord>
  }
>()('semu/tax/SettlementSnapshotRepository') {
  /** `tax_settlement_profit_loss`·`tax_settlement_cash_flow`·`tax_settlement_balance_sheet`·`tax_settlement_receivable_payable` 표에 둡니다. */
  static readonly layer = (seed: SettlementSnapshotSeed = {}) =>
    Layer.effect(
      SettlementSnapshotRepository,
      Effect.gen(function* () {
        return SettlementSnapshotRepository.of({
          profitLoss: yield* makeStore('tax_settlement_profit_loss', seed.profitLoss ?? []),
          cashFlow: yield* makeStore('tax_settlement_cash_flow', seed.cashFlow ?? []),
          balanceSheet: yield* makeStore('tax_settlement_balance_sheet', seed.balanceSheet ?? []),
          receivablePayable: yield* makeStore('tax_settlement_receivable_payable', seed.receivablePayable ?? []),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: SettlementSnapshotSeed = {}) =>
    SettlementSnapshotRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
