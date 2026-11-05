import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Classification } from '../evidence/evidence.types.ts'

/** 규칙이 속한 메뉴입니다. 매출 증빙, 매입 증빙, 입출금입니다. */
export type RuleScope = 'SALES' | 'PURCHASE' | 'BANK'

/** "이전 거래에도 적용하기"의 범위입니다. 빈 항목만 채우기, 입력된 항목도 덮어쓰기입니다. */
export type ApplyMode = 'FILL_EMPTY' | 'OVERWRITE'

/** 조건이 보는 값입니다. 증빙은 앞 일곱 개, 입출금은 뒤 다섯 개(`PARTNER` 포함)를 씁니다. */
export type RuleField =
  | 'PARTNER'
  | 'COUNTERPARTY'
  | 'ITEM'
  | 'TOTAL_AMOUNT'
  | 'SUPPLY_AMOUNT'
  | 'VAT_AMOUNT'
  | 'SOURCE'
  | 'SUMMARY'
  | 'AMOUNT'
  | 'ACCOUNT'
  | 'DIRECTION'

/** 조건 비교 방식입니다. 금액은 `GTE`·`LTE`·`BETWEEN`, 글자는 나머지입니다. */
export type RuleOperator = 'IN' | 'CONTAINS' | 'STARTS_WITH' | 'EQUALS' | 'GTE' | 'LTE' | 'BETWEEN'

/**
 * 규칙 조건 하나입니다. 규칙의 조건은 모두 맞아야 합니다(AND).
 *
 * 글자 비교는 `values` 중 하나만 맞으면 되고, 금액 비교는 원 단위 `min`·`max`를 절댓값과 비교합니다.
 */
export interface RuleCondition {
  field: RuleField
  operator: RuleOperator
  values?: ReadonlyArray<string>
  min?: number
  max?: number
}

/** 규칙의 상태입니다. 숨긴 규칙은 적용하지 않습니다. */
export type RuleStatus = 'ACTIVE' | 'HIDDEN'

/** 저장한 분류 규칙입니다. */
export interface ClassificationRuleRecord {
  id: Id<'classificationRule'>
  companyId: Id<'company'>
  scope: RuleScope
  /** 증빙 원천으로 규칙을 제한합니다. `null`이면 모든 원천입니다. */
  source: string | null
  name: string
  conditions: ReadonlyArray<RuleCondition>
  resultAccountTitleId: Id<'accountTitle'> | null
  resultPartnerId: Id<'partner'> | null
  /** 작을수록 먼저 시도합니다. */
  priority: number
  status: RuleStatus
  createdAt: string
  updatedAt: string
  version: number
}

/** 규칙 조건이 비교하는 값입니다. 증빙·입출금 한 건에서 모읍니다. */
export interface RuleFacts {
  partner: string | null
  counterparty: string
  item: string
  totalAmount: number
  supplyAmount: number
  vatAmount: number
  source: string | null
  summary: string
  amount: number
  account: string | null
  direction: 'DEPOSIT' | 'WITHDRAWAL' | null
}

/** 규칙이 분류할 수 있는 행과 지금 분류입니다. */
export interface ClassifiableRow {
  id: string
  facts: RuleFacts
  classification: Classification
  partnerId: string | null
}

/** 규칙이 행에 쓸 값입니다. 없는 키는 그대로 둡니다. */
export interface RuleUpdate {
  accountTitleId?: string
  partnerId?: string
}

/** 조건 검증 실패 하나입니다. `index`는 조건 순서(0부터)이고, 조건이 하나도 없으면 -1입니다. */
export interface ConditionViolation {
  index: number
  code: 'CONDITIONS_EMPTY' | 'FIELD_NOT_ALLOWED' | 'OPERATOR_NOT_ALLOWED' | 'OPERAND_REQUIRED' | 'RANGE_REVERSED'
}
