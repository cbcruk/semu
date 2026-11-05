import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import { AccountTitleId, ClassificationRuleId, PartnerId } from '../common/ids.ts'
import { IfMatchHeaders, QueryFlag } from '../common/wire.ts'
import { EvidenceSource, PartnerNotFound } from '../evidence/evidence.ts'
import {
  ApplyMode,
  ClassificationRule,
  ClassificationRuleInvalid,
  ClassificationRuleNotFound,
  ClassificationRuleOrderMismatch,
  RuleApplyJob,
  RuleCondition,
  RuleScope,
} from './classification-rule.ts'

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))
const params = { ruleId: ClassificationRuleId }
const draftErrors = [ClassificationRuleInvalid, AccountTitleNotAssignable, PartnerNotFound, PermissionDenied]
const Accepted = RuleApplyJob.pipe(HttpApiSchema.status(202))

/**
 * 자동 분류 규칙입니다. 범위(`SALES`·`PURCHASE`·`BANK`)마다 우선순위 순으로 처음 맞는 규칙 하나가 적용됩니다.
 *
 * 새로 수집한 거래에는 자동으로, 이전 거래에는 `:apply`로 적용합니다. `:apply`는 작업(`Job`)을 돌려줍니다.
 */
export class ClassificationRulesApi extends HttpApiGroup.make('classificationRules')
  .add(
    HttpApiEndpoint.get('list', '/classification-rules', {
      query: Schema.Struct({
        scope: Schema.optionalKey(RuleScope),
        /** 숨긴 규칙도 넣습니다. 기본은 `false`입니다. */
        includeHidden: Schema.optionalKey(QueryFlag),
      }),
      success: Schema.Struct({ items: Schema.Array(ClassificationRule) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.post('create', '/classification-rules', {
      payload: Schema.Struct({
        scope: RuleScope,
        source: Schema.optionalKey(Schema.NullOr(EvidenceSource)),
        name: Name,
        conditions: Schema.Array(RuleCondition),
        resultAccountTitleId: Schema.NullOr(AccountTitleId),
        resultPartnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
      }),
      success: ClassificationRule.pipe(HttpApiSchema.status(201)),
      error: draftErrors,
    }),
    HttpApiEndpoint.patch('update', '/classification-rules/:ruleId', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        source: Schema.optionalKey(Schema.NullOr(EvidenceSource)),
        name: Schema.optionalKey(Name),
        conditions: Schema.optionalKey(Schema.Array(RuleCondition)),
        resultAccountTitleId: Schema.optionalKey(Schema.NullOr(AccountTitleId)),
        resultPartnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
        /** 숨긴 규칙은 적용하지 않습니다. */
        status: Schema.optionalKey(Schema.Literals(['ACTIVE', 'HIDDEN'])),
      }),
      success: HttpApiSchema.WithHeaders(ClassificationRule, { etag: Schema.String }),
      error: [...draftErrors, ClassificationRuleNotFound, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/classification-rules/:ruleId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [ClassificationRuleNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.post('reorder', '/classification-rules::reorder', {
      payload: Schema.Struct({ scope: RuleScope, ruleIds: Schema.Array(ClassificationRuleId) }),
      success: Schema.Struct({ items: Schema.Array(ClassificationRule) }),
      error: [ClassificationRuleOrderMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('applyOne', '/classification-rules/:ruleId::apply', {
      params,
      payload: Schema.Struct({ mode: ApplyMode }),
      success: Accepted,
      error: [ClassificationRuleNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.post('applyAll', '/classification-rules::apply', {
      payload: Schema.Struct({ scope: RuleScope, mode: ApplyMode }),
      success: Accepted,
      error: PermissionDenied,
    }),
  )
  .middleware(Authentication) {}
