import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { AccountTitleId, ClassificationRuleId, JobId, PartnerId } from '../common/ids.ts'
import { EvidenceSource } from '../evidence/evidence.ts'

/** 규칙이 속한 메뉴입니다. */
export const RuleScope = Schema.Literals(['SALES', 'PURCHASE', 'BANK'])

/** 이전 거래에 적용하는 범위입니다. */
export const ApplyMode = Schema.Literals(['FILL_EMPTY', 'OVERWRITE'])

/** 규칙 조건 하나입니다. 글자 비교는 `values`, 금액 비교는 `min`·`max`(원, 절댓값 비교)를 씁니다. */
export const RuleCondition = Schema.Struct({
  field: Schema.Literals([
    'PARTNER',
    'COUNTERPARTY',
    'ITEM',
    'TOTAL_AMOUNT',
    'SUPPLY_AMOUNT',
    'VAT_AMOUNT',
    'SOURCE',
    'SUMMARY',
    'AMOUNT',
    'ACCOUNT',
    'DIRECTION',
  ]),
  operator: Schema.Literals(['IN', 'CONTAINS', 'STARTS_WITH', 'EQUALS', 'GTE', 'LTE', 'BETWEEN']),
  values: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  min: Schema.optionalKey(Schema.Int),
  max: Schema.optionalKey(Schema.Int),
})

/** 자동 분류 규칙입니다. 조건이 모두 맞으면 계정과목·거래처를 채웁니다. */
export const ClassificationRule = Schema.Struct({
  id: ClassificationRuleId,
  scope: RuleScope,
  source: Schema.NullOr(EvidenceSource),
  name: Schema.String,
  conditions: Schema.Array(RuleCondition),
  resultAccountTitleId: Schema.NullOr(AccountTitleId),
  resultPartnerId: Schema.NullOr(PartnerId),
  priority: Schema.Int,
  status: Schema.Literals(['ACTIVE', 'HIDDEN']),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  version: Schema.Int,
})

export type ClassificationRule = typeof ClassificationRule.Type

/** 규칙 적용 작업입니다. 메모리 구현은 요청 안에서 끝내고 `SUCCEEDED`로 돌려줍니다. */
export const RuleApplyJob = Schema.Struct({
  id: JobId,
  status: Schema.Literals(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
  result: Schema.optionalKey(Schema.Struct({ examinedCount: Schema.Int, updatedCount: Schema.Int })),
  createdAt: Schema.String,
  finishedAt: Schema.optionalKey(Schema.String),
})

export type RuleApplyJob = typeof RuleApplyJob.Type

/** 요청한 규칙이 없습니다. */
export class ClassificationRuleNotFound extends HttpApiError.Problem<ClassificationRuleNotFound>()(
  'ClassificationRuleNotFound',
  { type: problemType('CLASSIFICATION_RULE_NOT_FOUND'), status: 404, title: 'Classification rule not found' },
  { code: Schema.tag('CLASSIFICATION_RULE_NOT_FOUND') },
) {}

/** 규칙 조건이 범위에 맞지 않습니다. 위반을 모두 줍니다. `index`는 조건 위치이고 조건이 없으면 -1입니다. */
export class ClassificationRuleInvalid extends HttpApiError.Problem<ClassificationRuleInvalid>()(
  'ClassificationRuleInvalid',
  { type: problemType('CLASSIFICATION_RULE_INVALID'), status: 422, title: 'Classification rule is invalid' },
  {
    code: Schema.tag('CLASSIFICATION_RULE_INVALID'),
    violations: Schema.Array(
      Schema.Struct({
        index: Schema.Int,
        code: Schema.Literals([
          'CONDITIONS_EMPTY',
          'FIELD_NOT_ALLOWED',
          'OPERATOR_NOT_ALLOWED',
          'OPERAND_REQUIRED',
          'RANGE_REVERSED',
          'RESULT_REQUIRED',
          'SOURCE_NOT_ALLOWED',
        ]),
      }),
    ),
  },
) {}

/** 순서 바꾸기에 보낸 규칙 목록이 범위의 규칙 전체와 다릅니다. */
export class ClassificationRuleOrderMismatch extends HttpApiError.Problem<ClassificationRuleOrderMismatch>()(
  'ClassificationRuleOrderMismatch',
  { type: problemType('CLASSIFICATION_RULE_ORDER_MISMATCH'), status: 422, title: 'Send every rule of the scope once' },
  { code: Schema.tag('CLASSIFICATION_RULE_ORDER_MISMATCH') },
) {}
