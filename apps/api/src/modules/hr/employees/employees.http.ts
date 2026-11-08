import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { decodeHeaderText } from '../../../shared/personal-data/access-reason.ts'
import { Employees } from './employees.ts'

/** 직원 핸들러입니다. */
export const EmployeesHttpLive = HttpApiBuilder.group(
  Api,
  'hrEmployees',
  Effect.fn(function* (handlers) {
    const employees = yield* Employees
    const as = (permission: Parameters<typeof hrAccess>[0]) => authorize(hrAccess(permission))

    return handlers.handleAll({
      list: ({ query }) =>
        as('employee:read').pipe(
          Effect.flatMap((actor) =>
            employees.list(actor, {
              ...query,
              ...(query.kind === undefined ? {} : { kinds: [query.kind] }),
              ...(query.status === undefined ? {} : { statuses: [query.status] }),
            }),
          ),
        ),
      create: ({ payload }) => as('employee:create').pipe(Effect.flatMap((actor) => employees.create(actor, payload))),
      get: ({ params }) =>
        as('employee:read').pipe(
          Effect.flatMap((actor) => employees.get(actor, params.id)),
          Effect.map(withEtag),
        ),
      update: ({ params, headers, payload }) =>
        as('employee:update').pipe(
          Effect.flatMap((actor) => employees.update(actor, params.id, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      remove: ({ params }) => as('employee:delete').pipe(Effect.flatMap((actor) => employees.remove(actor, params.id))),
      revealRegistrationNumber: ({ params, headers }) =>
        as('employee:reveal-rrn').pipe(
          Effect.flatMap((actor) =>
            employees.revealRegistrationNumber(actor, params.id, decodeHeaderText(headers['x-access-reason'])),
          ),
        ),
      resign: ({ params, headers, payload }) =>
        as('employee:resign').pipe(
          Effect.flatMap((actor) => employees.resign(actor, params.id, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      cancelResignation: ({ params, headers }) =>
        as('employee:resign').pipe(
          Effect.flatMap((actor) =>
            employees.cancelResignation(actor, params.id, expectedVersion(headers['if-match'])),
          ),
          Effect.map(withEtag),
        ),
    })
  }),
)
