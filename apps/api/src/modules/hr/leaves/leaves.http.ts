import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { Leaves } from './leaves.ts'

/** 휴직 핸들러입니다. 휴직은 직원 정보라 `employee:*` 권한을 씁니다. */
export const LeavesHttpLive = HttpApiBuilder.group(
  Api,
  'hrLeaves',
  Effect.fn(function* (handlers) {
    const leaves = yield* Leaves
    const read = authorize(hrAccess('employee:read'))
    const write = authorize(hrAccess('employee:update'))

    return handlers.handleAll({
      list: ({ params }) => read.pipe(Effect.flatMap((actor) => leaves.list(actor, params.id))),
      create: ({ params, payload }) => write.pipe(Effect.flatMap((actor) => leaves.create(actor, params.id, payload))),
      returnFromLeave: ({ params, headers, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            leaves.returnFromLeave(
              actor,
              params.leaveId,
              payload.actualReturnDate,
              expectedVersion(headers['if-match']),
            ),
          ),
          Effect.map(withEtag),
        ),
      remove: ({ params }) => write.pipe(Effect.flatMap((actor) => leaves.remove(actor, params.leaveId))),
    })
  }),
)
