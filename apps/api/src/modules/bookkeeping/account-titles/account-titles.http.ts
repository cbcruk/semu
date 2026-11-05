import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { AccountTitleService } from './account-title-service.ts'

/** 계정과목 핸들러입니다. */
export const AccountTitlesHttpLive = HttpApiBuilder.group(
  Api,
  'accountTitles',
  Effect.fn(function* (handlers) {
    const titles = yield* AccountTitleService

    return handlers.handleAll({
      list: ({ query }) =>
        Effect.flatMap(requirePermission('account-title:read'), (actor) =>
          Effect.map(titles.list(actor.companyId, query), (items) => ({ items })),
        ),
      create: ({ payload }) =>
        Effect.flatMap(requirePermission('account-title:create'), (actor) => titles.create(actor.companyId, payload)),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('account-title:update'), (actor) =>
          titles
            .update(actor.companyId, params.accountTitleId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      remove: ({ params, query }) =>
        Effect.flatMap(requirePermission('account-title:delete'), (actor) =>
          titles.remove(actor.companyId, params.accountTitleId, query.moveToId),
        ),
    })
  }),
)
