import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { WorkContracts } from './work-contracts.ts'

/** 근로계약 핸들러입니다. */
export const WorkContractsHttpLive = HttpApiBuilder.group(
  Api,
  'hrWorkContracts',
  Effect.fn(function* (handlers) {
    const contracts = yield* WorkContracts
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
      indefiniteConversion: ({ params }) =>
        read.pipe(Effect.flatMap((actor) => contracts.indefiniteConversion(actor, params.id))),
    })
  }),
)
