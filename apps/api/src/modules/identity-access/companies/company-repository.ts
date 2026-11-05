import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Company } from './company.ts'

/** 회사 저장소입니다. 사업자등록번호는 유일합니다. */
export class CompanyRepository extends Context.Service<
  CompanyRepository,
  {
    findById(id: Id<'company'>): Effect.Effect<Option.Option<Company>>
    findByBusinessNumber(businessNumber: string): Effect.Effect<Option.Option<Company>>
    /** 모든 회사입니다. ID 순입니다. */
    list(): Effect.Effect<ReadonlyArray<Company>>
    save(company: Company): Effect.Effect<void>
  }
>()('semu/identity-access/CompanyRepository') {
  /** `iam_companies` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<Company> = []) =>
    Layer.effect(
      CompanyRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<Company>('iam_companies', {
          seed,
          companyOf: (company) => company.id,
        })
        return CompanyRepository.of({
          findById: (id) => table.get(id),
          findByBusinessNumber: (businessNumber) =>
            Effect.map(table.all(), (companies) =>
              Option.fromNullishOr(companies.find((company) => company.businessNumber === businessNumber)),
            ),
          list: () => Effect.map(table.all(), (companies) => companies.toSorted((a, b) => a.id.localeCompare(b.id))),
          save: (company) => table.put(company),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 회사를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<Company> = []) =>
    CompanyRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
