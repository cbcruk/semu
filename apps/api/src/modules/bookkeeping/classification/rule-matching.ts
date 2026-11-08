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

const 금액연산자: ReadonlyArray<RuleOperator> = ['GTE', 'LTE', 'BETWEEN']

const 증빙필드: Partial<Record<RuleField, ReadonlyArray<RuleOperator>>> = {
  PARTNER: ['IN'],
  COUNTERPARTY: ['CONTAINS', 'EQUALS'],
  ITEM: ['STARTS_WITH', 'CONTAINS', 'EQUALS'],
  TOTAL_AMOUNT: 금액연산자,
  SUPPLY_AMOUNT: 금액연산자,
  VAT_AMOUNT: 금액연산자,
  SOURCE: ['IN'],
}

/** 규칙 범위별로 쓸 수 있는 필드와 연산자입니다. */
export const SCOPE_FIELDS: Record<RuleScope, Partial<Record<RuleField, ReadonlyArray<RuleOperator>>>> = {
  SALES: 증빙필드,
  PURCHASE: 증빙필드,
  BANK: {
    SUMMARY: ['STARTS_WITH', 'CONTAINS', 'EQUALS'],
    AMOUNT: 금액연산자,
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
    const 허용연산자 = SCOPE_FIELDS[scope][condition.field]
    if (허용연산자 === undefined) return violations.push({ index, code: 'FIELD_NOT_ALLOWED' })
    if (!허용연산자.includes(condition.operator)) return violations.push({ index, code: 'OPERATOR_NOT_ALLOWED' })
    if (금액연산자.includes(condition.operator)) {
      const 최소금액이필요한가 = condition.operator !== 'LTE'
      const 최대금액이필요한가 = condition.operator !== 'GTE'
      if ((최소금액이필요한가 && condition.min === undefined) || (최대금액이필요한가 && condition.max === undefined)) {
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
  return rule.conditions.every((condition) => 조건에맞는가(condition, facts))
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
  const 바꿀값: RuleUpdate = {}
  const 현재계정과목 = row.classification.accountTitleId
  const 규칙계정과목 = result.accountTitleId
  if (
    규칙계정과목 !== null &&
    (mode === 'OVERWRITE' || 현재계정과목 === null) &&
    (규칙계정과목 !== 현재계정과목 || row.classification.method !== 'RULE')
  ) {
    바꿀값.accountTitleId = 규칙계정과목
  }
  const 규칙거래처 = result.partnerId
  if (규칙거래처 !== null && (mode === 'OVERWRITE' || row.partnerId === null) && 규칙거래처 !== row.partnerId) {
    바꿀값.partnerId = 규칙거래처
  }
  return 바꿀값.accountTitleId === undefined && 바꿀값.partnerId === undefined ? null : 바꿀값
}

/** 규칙 필드마다 볼 사실(facts) 값의 키입니다. */
const 필드별사실키: Record<RuleField, keyof RuleFacts> = {
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

function 조건에맞는가(condition: RuleCondition, facts: RuleFacts): boolean {
  const 사실값 = facts[필드별사실키[condition.field]]
  if (typeof 사실값 === 'number') {
    const 금액절댓값 = Math.abs(사실값)
    if (condition.operator === 'GTE') return 금액절댓값 >= (condition.min ?? 0)
    if (condition.operator === 'LTE') return 금액절댓값 <= (condition.max ?? 0)
    if (condition.operator === 'BETWEEN')
      return 금액절댓값 >= (condition.min ?? 0) && 금액절댓값 <= (condition.max ?? 0)
    return false
  }
  if (사실값 === null) return false
  const 사실글자 = 사실값.toLowerCase()
  const 비교글자 = (condition.values ?? []).map((비교값) => 비교값.toLowerCase())
  switch (condition.operator) {
    case 'IN':
    case 'EQUALS':
      return 비교글자.includes(사실글자)
    case 'CONTAINS':
      return 비교글자.some((비교값) => 사실글자.includes(비교값))
    case 'STARTS_WITH':
      return 비교글자.some((비교값) => 사실글자.startsWith(비교값))
    default:
      return false
  }
}
