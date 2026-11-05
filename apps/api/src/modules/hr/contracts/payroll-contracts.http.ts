import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { decodeHeaderText } from '../shared/hr-schemas.ts'
import { PayrollContracts } from './payroll-contracts.ts'

/** 급여계약 핸들러입니다. 계좌번호 원문은 `employee:reveal-account` 권한과 열람 사유가 필요합니다. */
export const PayrollContractsHttpLive = HttpApiBuilder.group(
  Api,
  'hrPayrollContracts',
  Effect.fn(function* (handlers) {
    const contracts = yield* PayrollContracts
    const read = authorize(hrAccess('employee:read'))
    const write = authorize(hrAccess('employee:update'))

    return handlers.handleAll({
      list: ({ params }) =>
        read.pipe(
          Effect.flatMap((actor) => contracts.list(actor, params.id)),
          Effect.map((items) => ({ items })),
        ),
      create: ({ params, payload }) =>
        write.pipe(Effect.flatMap((actor) => contracts.create(actor, params.id, payload))),
      get: ({ params }) =>
        read.pipe(
          Effect.flatMap((actor) => contracts.get(actor, params.payrollContractId)),
          Effect.map(withEtag),
        ),
      update: ({ params, headers, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            contracts.update(actor, params.payrollContractId, payload, expectedVersion(headers['if-match'])),
          ),
          Effect.map(withEtag),
        ),
      remove: ({ params }) => write.pipe(Effect.flatMap((actor) => contracts.remove(actor, params.payrollContractId))),
      revealAccountNumber: ({ params, headers }) =>
        authorize(hrAccess('employee:reveal-account')).pipe(
          Effect.flatMap((actor) =>
            contracts.revealAccountNumber(
              actor,
              params.payrollContractId,
              decodeHeaderText(headers['x-access-reason']),
            ),
          ),
        ),
    })
  }),
)
