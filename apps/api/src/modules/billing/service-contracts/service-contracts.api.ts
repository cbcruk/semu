import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { accessErrors } from '../billing-problems.ts'
import { ServiceContract, ServiceContractNotFound } from './service-contract.ts'

/**
 * 세무 기장 고객의 서비스 계약 조회입니다. 현행 `settings/company/:sfId/contract?name=`을 리소스로 바꿨습니다.
 *
 * 세무 기장(`TAXATION`) 고객만 봅니다.
 */
export class ServiceContractsApi extends HttpApiGroup.make('serviceContracts')
  .add(
    HttpApiEndpoint.get('list', '/service-contracts', {
      success: Schema.Struct({ items: Schema.Array(ServiceContract) }),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('get', '/service-contracts/:serviceContractId', {
      params: { serviceContractId: IdSchema('serviceContract') },
      success: ServiceContract,
      error: [...accessErrors, ServiceContractNotFound],
    }),
  )
  .middleware(Authentication) {}
