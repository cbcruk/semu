import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { AccessReasonHeaders } from '../../../shared/personal-data/access-reason.ts'
import { EmployeeId, IfMatchHeaders, PayrollContractId } from '../shared/hr-schemas.ts'
import {
  PayrollContract,
  PayrollContractInput,
  PayrollContractInvalid,
  PayrollContractNotFound,
} from './payroll-contract.ts'

const params = { payrollContractId: PayrollContractId }
const withEtag = HttpApiSchema.WithHeaders(PayrollContract, { etag: Schema.String })

/**
 * 급여계약입니다. 근로소득자(`WAGE`)만 가질 수 있고, 직원 아래에서 만든 뒤에는 급여계약 ID로 다룹니다.
 *
 * 파생 금액(`derived`)은 서버가 계산합니다. 최저임금 미달은 저장을 막지 않고 `warnings`에 `BELOW_MINIMUM_WAGE`로 담습니다.
 */
export class PayrollContractsApi extends HttpApiGroup.make('hrPayrollContracts')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/payroll-contracts', {
      params: { id: EmployeeId },
      success: Schema.Struct({ items: Schema.Array(PayrollContract) }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('create', '/employees/:id/payroll-contracts', {
      params: { id: EmployeeId },
      payload: PayrollContractInput,
      success: PayrollContract.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeNotFound, EmployeeKindNotSupported, PayrollContractInvalid],
    }),
    HttpApiEndpoint.get('get', '/payroll-contracts/:payrollContractId', {
      params,
      success: withEtag,
      error: [...ACCESS_ERRORS, PayrollContractNotFound],
    }),
    HttpApiEndpoint.put('update', '/payroll-contracts/:payrollContractId', {
      params,
      headers: IfMatchHeaders,
      payload: PayrollContractInput,
      success: withEtag,
      error: [...ACCESS_ERRORS, PayrollContractNotFound, PayrollContractInvalid, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/payroll-contracts/:payrollContractId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, PayrollContractNotFound],
    }),
    HttpApiEndpoint.get('revealAccountNumber', '/payroll-contracts/:payrollContractId/account-number', {
      params,
      headers: AccessReasonHeaders,
      success: Schema.Struct({ accountNumber: Schema.String }),
      error: [...ACCESS_ERRORS, PayrollContractNotFound],
    }),
  )
  .middleware(Authentication) {}
