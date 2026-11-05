import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Company } from './company.ts'

/** 회사 저장소입니다. 사업자등록번호는 유일합니다. */
export class CompanyRepository extends Context.Service<
  CompanyRepository,
  {
    findById(id: Id<'company'>): Effect.Effect<Option.Option<Company>>
    findByBusinessNumber(businessNumber: string): Effect.Effect<Option.Option<Company>>
    save(company: Company): Effect.Effect<void>
  }
>()('semu/identity-access/CompanyRepository') {
  /** `seed`로 시작해 프로세스 메모리에 회사를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<Company> = []) =>
    Layer.effect(
      CompanyRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((company) => [company.id, company])))
        return CompanyRepository.of({
          findById: (id) => Ref.get(store).pipe(Effect.map((companies) => Option.fromNullishOr(companies.get(id)))),
          findByBusinessNumber: (businessNumber) =>
            Ref.get(store).pipe(
              Effect.map((companies) =>
                Option.fromNullishOr(
                  [...companies.values()].find((company) => company.businessNumber === businessNumber),
                ),
              ),
            ),
          save: (company) => Ref.update(store, (companies) => new Map(companies).set(company.id, company)),
        })
      }),
    )
}
