import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { cannotFail, expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { ClassificationRuleService } from './classification-rule-service.ts'

/** 자동 분류 규칙 핸들러입니다. */
export const ClassificationRulesHttpLive = HttpApiBuilder.group(
  Api,
  'classificationRules',
  Effect.fn(function* (handlers) {
    const rules = yield* ClassificationRuleService

    return handlers.handleAll({
      list: ({ query }) =>
        Effect.flatMap(requirePermission('classification-rule:read'), (actor) =>
          Effect.map(
            rules.list(actor.companyId, {
              ...(query.scope === undefined ? {} : { scope: query.scope }),
              includeHidden: query.includeHidden === 'true',
            }),
            (items) => ({ items }),
          ),
        ),
      create: ({ payload }) =>
        Effect.flatMap(requirePermission('classification-rule:create'), (actor) =>
          rules.create(actor.companyId, {
            ...payload,
            source: payload.source ?? null,
            resultPartnerId: payload.resultPartnerId ?? null,
          }),
        ),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('classification-rule:update'), (actor) =>
          rules
            .update(actor.companyId, params.ruleId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      remove: ({ params }) =>
        Effect.flatMap(requirePermission('classification-rule:delete'), (actor) =>
          rules.remove(actor.companyId, params.ruleId),
        ),
      reorder: ({ payload }) =>
        Effect.flatMap(requirePermission('classification-rule:update'), (actor) =>
          Effect.map(rules.reorder(actor.companyId, payload.scope, payload.ruleIds), (items) => ({ items })),
        ),
      applyOne: ({ params, payload }) =>
        Effect.flatMap(requirePermission('classification-rule:apply'), (actor) =>
          rules.apply(actor.companyId, { ruleId: params.ruleId }, payload.mode),
        ),
      applyAll: ({ payload }) =>
        Effect.flatMap(requirePermission('classification-rule:apply'), (actor) =>
          rules
            .apply(actor.companyId, { scope: payload.scope }, payload.mode)
            .pipe(cannotFail('ClassificationRuleNotFound')),
        ),
    })
  }),
)
