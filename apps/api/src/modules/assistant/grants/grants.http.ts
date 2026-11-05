import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { Grants } from './grants.ts'

const read = { permission: 'grant:read' } as const

/** 지원사업 공고·추천 핸들러입니다. */
export const GrantsHttpLive = HttpApiBuilder.group(
  Api,
  'grants',
  Effect.fn(function* (handlers) {
    const grants = yield* Grants
    return handlers.handleAll({
      list: ({ query }) => authorize(read).pipe(Effect.flatMap(() => grants.listOpen(query))),
      get: ({ params }) => authorize(read).pipe(Effect.flatMap(() => grants.get(params.grantId))),
      recommend: () =>
        authorize(read).pipe(
          Effect.flatMap(grants.recommend),
          Effect.map((items) => ({ items })),
        ),
    })
  }),
)
