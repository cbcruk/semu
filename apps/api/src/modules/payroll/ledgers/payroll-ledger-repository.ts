import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

/** 급여대장 애그리거트 저장소입니다. 대장과 행을 한 단위로 읽고 씁니다. */
export class PayrollLedgerRepository extends Context.Service<
  PayrollLedgerRepository,
  {
    /** 회사의 모든 대장입니다. 귀속월·생성 순서로 정렬합니다. */
    list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<PayrollLedgerRecord>>
    find(companyId: Id<'company'>, id: Id<'payrollLedger'>): Effect.Effect<Option.Option<PayrollLedgerRecord>>
    save(ledger: PayrollLedgerRecord): Effect.Effect<void>
    remove(companyId: Id<'company'>, id: Id<'payrollLedger'>): Effect.Effect<void>
  }
>()('semu/payroll/PayrollLedgerRepository') {
  /**
   * `payroll_ledgers` 표에 둡니다. 행은 대장 레코드 안에 함께 저장합니다. 표가 비어 있으면 `seed`로 시작합니다.
   * 저장 방식은 {@link TableFactory}가 정합니다.
   */
  static readonly layer = (seed: ReadonlyArray<PayrollLedgerRecord> = []) =>
    Layer.effect(
      PayrollLedgerRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<PayrollLedgerRecord>('payroll_ledgers', {
          seed,
          companyOf: (ledger) => ledger.companyId,
        })
        return PayrollLedgerRepository.of({
          list: (companyId) =>
            Effect.map(table.byCompany(companyId), (ledgers) =>
              ledgers.toSorted(
                (a, b) => a.attributionMonth.localeCompare(b.attributionMonth) || a.id.localeCompare(b.id),
              ),
            ),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((ledger) => ledger.companyId === companyId),
            ),
          save: (ledger) => table.put(ledger),
          remove: (companyId, id) =>
            Effect.flatMap(table.get(id), (found) =>
              Option.isSome(found) && found.value.companyId === companyId ? table.remove(id) : Effect.void,
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PayrollLedgerRecord> = []) =>
    PayrollLedgerRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
