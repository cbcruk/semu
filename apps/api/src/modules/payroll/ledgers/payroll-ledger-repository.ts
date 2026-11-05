import { Context, Effect, Layer, Option, Ref } from 'effect'
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
  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PayrollLedgerRecord> = []) =>
    Layer.effect(
      PayrollLedgerRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((ledger) => [ledger.id, ledger])))
        return PayrollLedgerRepository.of({
          list: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((map) =>
                [...map.values()]
                  .filter((ledger) => ledger.companyId === companyId)
                  .sort((a, b) => a.attributionMonth.localeCompare(b.attributionMonth) || a.id.localeCompare(b.id)),
              ),
            ),
          find: (companyId, id) =>
            Ref.get(store).pipe(
              Effect.map((map) =>
                Option.fromNullishOr(map.get(id)).pipe(Option.filter((l) => l.companyId === companyId)),
              ),
            ),
          save: (ledger) => Ref.update(store, (map) => new Map(map).set(ledger.id, ledger)),
          remove: (companyId, id) =>
            Ref.update(store, (map) => {
              const next = new Map(map)
              if (next.get(id)?.companyId === companyId) next.delete(id)
              return next
            }),
        })
      }),
    )
}
