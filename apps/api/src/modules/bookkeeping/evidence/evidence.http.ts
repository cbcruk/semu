import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { EvidenceService } from './evidence-service.ts'

/** 증빙 핸들러입니다. */
export const EvidenceHttpLive = HttpApiBuilder.group(
  Api,
  'evidence',
  Effect.fn(function* (handlers) {
    const evidence = yield* EvidenceService

    return handlers.handleAll({
      list: ({ query: { limit, cursor, ...filter } }) =>
        Effect.flatMap(requirePermission('evidence:read'), (actor) =>
          evidence.list(actor.companyId, filter, {
            ...(limit === undefined ? {} : { limit }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      count: ({ query }) =>
        Effect.flatMap(requirePermission('evidence:read'), (actor) => evidence.count(actor.companyId, query)),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('evidence:read'), (actor) =>
          evidence.get(actor.companyId, params.evidenceId).pipe(Effect.map(withEtag)),
        ),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('evidence:update'), (actor) =>
          evidence
            .update(actor.companyId, params.evidenceId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      classify: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('evidence:classify'), (actor) =>
          evidence
            .classify(actor.companyId, params.evidenceId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      batchClassify: ({ payload }) =>
        Effect.flatMap(requirePermission('evidence:classify'), (actor) =>
          evidence.batchClassify(actor.companyId, payload.evidenceIds, payload.accountTitleId),
        ),
    })
  }),
)
