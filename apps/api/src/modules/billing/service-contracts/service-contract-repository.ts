import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { ServiceContract, ServiceContractId, ServiceContractRecord } from './service-contract.ts'

/** 저장한 서비스 계약에서 회사 ID를 뺀 응답입니다. */
export function toServiceContract(record: ServiceContractRecord): ServiceContract {
  const { companyId: _, ...contract } = record
  return contract
}

/** 서비스 계약 저장소입니다. */
export class ServiceContractRepository extends Context.Service<
  ServiceContractRepository,
  {
    find(companyId: Id<'company'>, contractId: ServiceContractId): Effect.Effect<Option.Option<ServiceContractRecord>>
    /** 회사의 계약을 시작일 최신순으로 돌려줍니다. */
    listByCompany(companyId: Id<'company'>): Effect.Effect<ServiceContractRecord[]>
  }
>()('semu/billing/ServiceContractRepository') {
  /** `seed`로 시작해 프로세스 메모리에 서비스 계약을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ServiceContractRecord> = []) =>
    Layer.effect(
      ServiceContractRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((row) => [row.id, row])))
        return ServiceContractRepository.of({
          find: (companyId, contractId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                Option.filter(Option.fromNullishOr(rows.get(contractId)), (row) => row.companyId === companyId),
              ),
            ),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((rows) =>
                [...rows.values()]
                  .filter((row) => row.companyId === companyId)
                  .sort((a, b) => b.startsOn.localeCompare(a.startsOn) || a.id.localeCompare(b.id)),
              ),
            ),
        })
      }),
    )
}
