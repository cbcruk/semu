import { Context, Effect, Layer, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { InsuranceFiling, InsuranceFilingKind, InsuranceFilingSource } from './insurance-filing.types.ts'

/** 4대보험 신고 저장소입니다. */
export class InsuranceFilingRepository extends Context.Service<
  InsuranceFilingRepository,
  {
    listByEmployee(companyId: Id<'company'>, employeeId: Id<'employee'>): Effect.Effect<ReadonlyArray<InsuranceFiling>>
    save(filing: InsuranceFiling): Effect.Effect<void>
    /** 같은 원인·종류의 `PENDING` 신고를 `WITHDRAWN`으로 닫습니다. */
    withdraw(
      companyId: Id<'company'>,
      source: InsuranceFilingSource,
      kind: InsuranceFilingKind,
      at: string,
    ): Effect.Effect<void>
  }
>()('semu/hr/InsuranceFilingRepository') {
  /** `seed`로 시작해 프로세스 메모리에 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<InsuranceFiling> = []) =>
    Layer.effect(
      InsuranceFilingRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((filing) => [filing.id, filing])))
        return InsuranceFilingRepository.of({
          listByEmployee: (companyId, employeeId) =>
            Ref.get(store).pipe(
              Effect.map((filings) =>
                [...filings.values()].filter((f) => f.companyId === companyId && f.employeeId === employeeId),
              ),
            ),
          save: (filing) => Ref.update(store, (filings) => new Map(filings).set(filing.id, filing)),
          withdraw: (companyId, source, kind, at) =>
            Ref.update(store, (filings) => {
              const next = new Map(filings)
              for (const filing of filings.values()) {
                const matches =
                  filing.companyId === companyId &&
                  filing.kind === kind &&
                  filing.status === 'PENDING' &&
                  filing.source.type === source.type &&
                  filing.source.id === source.id
                if (matches) next.set(filing.id, { ...filing, status: 'WITHDRAWN', processedAt: at })
              }
              return next
            }),
        })
      }),
    )
}
