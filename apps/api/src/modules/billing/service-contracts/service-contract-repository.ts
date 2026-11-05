import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `billing_service_contracts` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<ServiceContractRecord> = []) =>
    Layer.effect(
      ServiceContractRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<ServiceContractRecord>('billing_service_contracts', {
          seed,
          companyOf: (row) => row.companyId,
        })
        return ServiceContractRepository.of({
          find: (companyId, contractId) =>
            Effect.map(
              table.get(contractId),
              Option.filter((row) => row.companyId === companyId),
            ),
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (rows) =>
              rows.toSorted((a, b) => b.startsOn.localeCompare(a.startsOn) || a.id.localeCompare(b.id)),
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 서비스 계약을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ServiceContractRecord> = []) =>
    ServiceContractRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
