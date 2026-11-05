import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { ServiceContractRepository, toServiceContract } from './service-contract-repository.ts'
import { ServiceContractNotFound } from './service-contract.ts'

const access = { permission: 'service-contract:read', plans: ['TAXATION'] } as const

/** 서비스 계약 핸들러입니다. 읽기뿐이라 저장소를 바로 씁니다. */
export const ServiceContractsHttpLive = HttpApiBuilder.group(
  Api,
  'serviceContracts',
  Effect.fn(function* (handlers) {
    const contracts = yield* ServiceContractRepository
    return handlers.handleAll({
      list: () =>
        Effect.gen(function* () {
          const actor = yield* authorize(access)
          const rows = yield* contracts.listByCompany(actor.companyId)
          return { items: rows.map(toServiceContract) }
        }),
      get: ({ params }) =>
        Effect.gen(function* () {
          const actor = yield* authorize(access)
          const row = yield* contracts.find(actor.companyId, params.serviceContractId)
          if (row._tag === 'None') return yield* new ServiceContractNotFound({})
          return toServiceContract(row.value)
        }),
    })
  }),
)
