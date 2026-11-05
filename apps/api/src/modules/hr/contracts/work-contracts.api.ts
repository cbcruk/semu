import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId } from '../shared/hr-schemas.ts'
import { IndefiniteConversionView, WorkContract, WorkContractInput, WorkContractInvalid } from './work-contract.ts'

const params = { id: EmployeeId }

/** 근로계약과 무기계약 전환 판정입니다. 계약은 유효일(시작일) 이력으로 쌓습니다. */
export class WorkContractsApi extends HttpApiGroup.make('hrWorkContracts')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/work-contracts', {
      params,
      success: Schema.Struct({ items: Schema.Array(WorkContract) }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('create', '/employees/:id/work-contracts', {
      params,
      payload: WorkContractInput,
      success: WorkContract.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeNotFound, WorkContractInvalid],
    }),
    HttpApiEndpoint.get('indefiniteConversion', '/employees/:id/indefinite-conversion', {
      params,
      success: IndefiniteConversionView,
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
  )
  .middleware(Authentication) {}
