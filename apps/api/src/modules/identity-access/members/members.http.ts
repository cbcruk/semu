import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../authorization.ts'
import { Members } from './members.ts'

/** 구성원 핸들러입니다. */
export const MembersHttpLive = HttpApiBuilder.group(
  Api,
  'members',
  Effect.fn(function* (handlers) {
    const members = yield* Members
    return handlers.handleAll({
      list: ({ query }) =>
        authorize({ permission: 'member:read' }).pipe(Effect.flatMap((actor) => members.list(actor, query))),
      get: ({ params }) =>
        authorize({ permission: 'member:read' }).pipe(
          Effect.flatMap((actor) => members.get(actor, params.userId)),
          Effect.map(withEtag),
        ),
      changeAccess: ({ params, headers, payload }) =>
        authorize({ permission: 'member:update' }).pipe(
          Effect.flatMap((actor) =>
            members.changeAccess(actor, params.userId, payload, expectedVersion(headers['if-match'])),
          ),
          Effect.map(withEtag),
        ),
      remove: ({ params }) =>
        authorize({ permission: 'member:remove' }).pipe(
          Effect.flatMap((actor) => members.remove(actor, params.userId)),
        ),
    })
  }),
)
