import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import type { Permission } from '../../identity-access/actor.types.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { documentsAccess } from '../shared/documents-schemas.ts'
import { EsignRequests } from './esign-requests.ts'

/** 전자서명 요청 핸들러입니다. */
export const EsignRequestsHttpLive = HttpApiBuilder.group(
  Api,
  'esignRequests',
  Effect.fn(function* (handlers) {
    const requests = yield* EsignRequests
    const as = (permission: Permission) => authorize(documentsAccess(permission))

    return handlers.handleAll({
      list: ({ query }) => as('esign-request:read').pipe(Effect.flatMap((actor) => requests.list(actor, query))),
      create: ({ payload }) =>
        as('esign-request:create').pipe(Effect.flatMap((actor) => requests.create(actor, payload))),
      get: ({ params }) =>
        as('esign-request:read').pipe(
          Effect.flatMap((actor) => requests.get(actor, params.id)),
          Effect.map(withEtag),
        ),
      update: ({ params, headers, payload }) =>
        as('esign-request:update').pipe(
          Effect.flatMap((actor) => requests.update(actor, params.id, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      remove: ({ params }) =>
        as('esign-request:delete').pipe(Effect.flatMap((actor) => requests.remove(actor, params.id))),
      send: ({ params, headers }) =>
        as('esign-request:send').pipe(
          Effect.flatMap((actor) => requests.send(actor, params.id, 'SEND', expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      resend: ({ params, headers }) =>
        as('esign-request:send').pipe(
          Effect.flatMap((actor) => requests.send(actor, params.id, 'RESEND', expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      revertToDraft: ({ params, headers }) =>
        as('esign-request:update').pipe(
          Effect.flatMap((actor) =>
            requests.apply(actor, params.id, 'REVERT_TO_DRAFT', expectedVersion(headers['if-match'])),
          ),
          Effect.map(withEtag),
        ),
      cancel: ({ params, headers }) =>
        as('esign-request:cancel').pipe(
          Effect.flatMap((actor) => requests.apply(actor, params.id, 'CANCEL', expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      void: ({ params, headers }) =>
        as('esign-request:void').pipe(
          Effect.flatMap((actor) => requests.apply(actor, params.id, 'VOID', expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
    })
  }),
)
