import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `hr_insurance_filings` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<InsuranceFiling> = []) =>
    Layer.effect(
      InsuranceFilingRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<InsuranceFiling>('hr_insurance_filings', {
          seed,
          companyOf: (filing) => filing.companyId,
        })
        return InsuranceFilingRepository.of({
          listByEmployee: (companyId, employeeId) =>
            Effect.map(table.byCompany(companyId), (filings) => filings.filter((f) => f.employeeId === employeeId)),
          save: (filing) => table.put(filing),
          withdraw: (companyId, source, kind, at) =>
            Effect.flatMap(table.byCompany(companyId), (filings) =>
              Effect.forEach(
                filings.filter(
                  (filing) =>
                    filing.kind === kind &&
                    filing.status === 'PENDING' &&
                    filing.source.type === source.type &&
                    filing.source.id === source.id,
                ),
                (filing) => table.put({ ...filing, status: 'WITHDRAWN', processedAt: at }),
                { discard: true },
              ),
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<InsuranceFiling> = []) =>
    InsuranceFilingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
