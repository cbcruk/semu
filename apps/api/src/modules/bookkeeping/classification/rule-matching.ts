import type {
  ApplyMode,
  ClassifiableRow,
  ConditionViolation,
  RuleCondition,
  RuleFacts,
  RuleField,
  RuleOperator,
  RuleScope,
  RuleUpdate,
} from './classification-rule.types.ts'

/**
 * `OVERWRITE`가 사람이 직접 분류한 행을 건너뛰는지입니다.
 *
 * 현행 스펙은 정하지 않았습니다. 사용자의 정정을 말없이 되돌리지 않으려고 건너뜁니다
 * (`docs/design/rule-decisions/bookkeeping.md`의 classification-apply-mode 1).
 */
export const OVERWRITE_KEEPS_MANUAL = true

const AMOUNT_OPERATORS: ReadonlyArray<RuleOperator> = ['GTE', 'LTE', 'BETWEEN']

const EVIDENCE_FIELDS: Partial<Record<RuleField, ReadonlyArray<RuleOperator>>> = {
  PARTNER: ['IN'],
  COUNTERPARTY: ['CONTAINS', 'EQUALS'],
  ITEM: ['STARTS_WITH', 'CONTAINS', 'EQUALS'],
  TOTAL_AMOUNT: AMOUNT_OPERATORS,
  SUPPLY_AMOUNT: AMOUNT_OPERATORS,
  VAT_AMOUNT: AMOUNT_OPERATORS,
  SOURCE: ['IN'],
}

/** 규칙 범위별로 쓸 수 있는 필드와 연산자입니다. */
export const SCOPE_FIELDS: Record<RuleScope, Partial<Record<RuleField, ReadonlyArray<RuleOperator>>>> = {
  SALES: EVIDENCE_FIELDS,
  PURCHASE: EVIDENCE_FIELDS,
  BANK: {
    SUMMARY: ['STARTS_WITH', 'CONTAINS', 'EQUALS'],
    AMOUNT: AMOUNT_OPERATORS,
    ACCOUNT: ['IN'],
    DIRECTION: ['EQUALS'],
    PARTNER: ['IN'],
  },
}

/**
 * 조건을 {@link SCOPE_FIELDS}와 연산자별 피연산자로 검사해 위반을 모두 돌려줍니다. 비어 있으면 통과입니다.
 *
 * 현행은 첫 위반 하나만 문장으로 돌려줬습니다. 재설계는 422 `violations`로 모두 줍니다.
 */
export function conditionViolations(scope: RuleScope, conditions: ReadonlyArray<RuleCondition>): ConditionViolation[] {
  if (conditions.length === 0) return [{ index: -1, code: 'CONDITIONS_EMPTY' }]
  const violations: ConditionViolation[] = []
  conditions.forEach((condition, index) => {
    const operators = SCOPE_FIELDS[scope][condition.field]
    if (operators === undefined) return violations.push({ index, code: 'FIELD_NOT_ALLOWED' })
    if (!operators.includes(condition.operator)) return violations.push({ index, code: 'OPERATOR_NOT_ALLOWED' })
    if (AMOUNT_OPERATORS.includes(condition.operator)) {
      const needsMin = condition.operator !== 'LTE'
      const needsMax = condition.operator !== 'GTE'
      if ((needsMin && condition.min === undefined) || (needsMax && condition.max === undefined)) {
        return violations.push({ index, code: 'OPERAND_REQUIRED' })
      }
      if (condition.operator === 'BETWEEN' && (condition.min ?? 0) > (condition.max ?? 0)) {
        return violations.push({ index, code: 'RANGE_REVERSED' })
      }
      return undefined
    }
    if (condition.values === undefined || condition.values.length === 0) {
      violations.push({ index, code: 'OPERAND_REQUIRED' })
    }
    return undefined
  })
  return violations
}

/**
 * 규칙의 원천 제한과 조건이 모두 행에 맞는지입니다.
 *
 * - 금액은 절댓값으로 비교합니다. 취소(음수) 거래도 같은 규칙에 걸립니다
 * - 글자는 대소문자를 가리지 않습니다. 값이 없는 필드(`null`)는 맞지 않습니다
 */
export function matchesRule(
  rule: { source: string | null; conditions: ReadonlyArray<RuleCondition> },
  facts: RuleFacts,
): boolean {
  if (rule.source !== null && rule.source !== facts.source) return false
  return rule.conditions.every((condition) => matchesCondition(condition, facts))
}

/** 우선순위 순으로 정렬된 규칙 가운데 처음 맞는 하나입니다. 숨긴 규칙은 호출하는 쪽이 미리 뺍니다. */
export function firstMatchingRule<R extends { source: string | null; conditions: ReadonlyArray<RuleCondition> }>(
  rules: ReadonlyArray<R>,
  facts: RuleFacts,
): R | undefined {
  return rules.find((rule) => matchesRule(rule, facts))
}

/**
 * 맞은 규칙이 행에서 바꿀 값을 정합니다. 바꿀 것이 없으면 `null`입니다.
 *
 * - `FILL_EMPTY`: 비어 있는 계정과목·거래처만 채웁니다
 * - `OVERWRITE`: 둘 다 덮지만, 사람이 분류한 행은 건드리지 않습니다({@link OVERWRITE_KEEPS_MANUAL})
 * - 같은 계정을 이미 규칙으로 분류했으면 다시 쓰지 않습니다. 같은 계정이라도 사람이 분류했다면(`FILL_EMPTY`에서는
 *   비어 있지 않으므로 해당 없음) 규칙 분류로 바뀝니다
 */
export function planRuleUpdate(
  row: Pick<ClassifiableRow, 'classification' | 'partnerId'>,
  result: { accountTitleId: string | null; partnerId: string | null },
  mode: ApplyMode,
): RuleUpdate | null {
  if (mode === 'OVERWRITE' && OVERWRITE_KEEPS_MANUAL && row.classification.method === 'MANUAL') return null
  const update: RuleUpdate = {}
  const current = row.classification.accountTitleId
  const account = result.accountTitleId
  if (
    account !== null &&
    (mode === 'OVERWRITE' || current === null) &&
    (account !== current || row.classification.method !== 'RULE')
  ) {
    update.accountTitleId = account
  }
  const partner = result.partnerId
  if (partner !== null && (mode === 'OVERWRITE' || row.partnerId === null) && partner !== row.partnerId) {
    update.partnerId = partner
  }
  return update.accountTitleId === undefined && update.partnerId === undefined ? null : update
}

const FACT_KEYS: Record<RuleField, keyof RuleFacts> = {
  PARTNER: 'partner',
  COUNTERPARTY: 'counterparty',
  ITEM: 'item',
  TOTAL_AMOUNT: 'totalAmount',
  SUPPLY_AMOUNT: 'supplyAmount',
  VAT_AMOUNT: 'vatAmount',
  SOURCE: 'source',
  SUMMARY: 'summary',
  AMOUNT: 'amount',
  ACCOUNT: 'account',
  DIRECTION: 'direction',
}

function matchesCondition(condition: RuleCondition, facts: RuleFacts): boolean {
  const value = facts[FACT_KEYS[condition.field]]
  if (typeof value === 'number') {
    const amount = Math.abs(value)
    if (condition.operator === 'GTE') return amount >= (condition.min ?? 0)
    if (condition.operator === 'LTE') return amount <= (condition.max ?? 0)
    if (condition.operator === 'BETWEEN') return amount >= (condition.min ?? 0) && amount <= (condition.max ?? 0)
    return false
  }
  if (value === null) return false
  const text = value.toLowerCase()
  const values = (condition.values ?? []).map((candidate) => candidate.toLowerCase())
  switch (condition.operator) {
    case 'IN':
    case 'EQUALS':
      return values.includes(text)
    case 'CONTAINS':
      return values.some((candidate) => text.includes(candidate))
    case 'STARTS_WITH':
      return values.some((candidate) => text.startsWith(candidate))
    default:
      return false
  }
}
